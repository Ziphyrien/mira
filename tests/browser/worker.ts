import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import { HttpOptions_Style, Miniflare } from "miniflare";
import { adminToken, baseURL, port } from "./fixture.ts";
import { createProvider } from "./provider.ts";
import { outboundHandler } from "./outbound.ts";

const bundle = resolve(".wrangler/browser-test");
const modules: Record<
  string,
  { type: "esm" | "wasm"; contents: string | Uint8Array<ArrayBuffer> }
> = {};
for (const file of readdirSync(bundle, { recursive: true, encoding: "utf8" })) {
  if (![".js", ".wasm"].includes(extname(file))) continue;
  modules[file.replaceAll("\\", "/")] =
    extname(file) === ".wasm"
      ? { type: "wasm", contents: readFileSync(resolve(bundle, file)) }
      : { type: "esm", contents: readFileSync(resolve(bundle, file), "utf8") };
}
assert.ok(modules["index.js"], "Run bun run test:browser to build the Worker first");
const upstream = createProvider();
const upstreamServer = createServer(outboundHandler(upstream.fetch));
upstreamServer.listen(0, "127.0.0.1");
await once(upstreamServer, "listening");
const upstreamAddress = upstreamServer.address();
assert.ok(upstreamAddress && typeof upstreamAddress !== "string");

const runtime = new Miniflare({
  host: "127.0.0.1",
  port,
  cf: false,
  logRequests: false,
  workers: [
    {
      config: {
        name: "mira-browser-test",
        compatibilityDate: "2026-10-01",
        compatibilityFlags: ["nodejs_compat"],
        manifest: { mainModule: "index.js", modulesRoot: bundle, modules },
        env: {
          ADMIN_TOKEN: { type: "text", value: adminToken },
          ASSETS: { type: "assets" },
          SPACE: { type: "durable-object", worker: "mira-browser-test", exportName: "Space" },
          DIRECTORY: {
            type: "durable-object",
            worker: "mira-browser-test",
            exportName: "Directory",
          },
        },
        exports: {
          Space: { type: "durable-object", storage: "sqlite" },
          Directory: { type: "durable-object", storage: "sqlite" },
        },
        assets: { directory: resolve(".svelte-kit/cloudflare"), hasUserWorker: true },
      },
      dev: { outboundService: { type: "worker", worker: "synthetic-provider" } },
    },
    {
      config: {
        name: "synthetic-provider",
        compatibilityDate: "2026-10-01",
        compatibilityFlags: ["enable_request_signal", "request_signal_passthrough"],
        manifest: {
          mainModule: "provider.js",
          modulesRoot: bundle,
          modules: {
            "provider.js": {
              type: "esm",
              contents:
                "export default { fetch(request, env) { const url = new URL(request.url); url.protocol = 'http:'; return env.ORIGIN.fetch(new Request(url, request)); } };",
            },
          },
        },
        env: {
          ORIGIN: {
            type: "external",
            address: `127.0.0.1:${upstreamAddress.port}`,
            http: { style: HttpOptions_Style.HOST },
          },
        },
      },
    },
  ],
});
async function shutdown() {
  upstream.dispose();
  await runtime.dispose();
  upstreamServer.closeAllConnections();
  upstreamServer.close();
}
process.once("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
process.once("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
try {
  await runtime.ready;
  const login = await runtime.dispatchFetch(`${baseURL}/api/admin/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: adminToken }),
  });
  assert.equal(login.status, 200, "Fixture admin authentication must succeed");
  const cookie = login.headers.get("set-cookie");
  assert.ok(cookie);
  const choice = { provider: "deepseek", modelId: "deepseek-flash" };
  const configured = await runtime.dispatchFetch(`${baseURL}/api/admin/models`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie.split(";")[0] },
    body: JSON.stringify({
      keys: { deepseek: "synthetic-key", mimo: "synthetic-speech-key" },
      chat: choice,
      memory: { provider: "deepseek", modelId: "deepseek-v4-pro" },
    }),
  });
  assert.equal(configured.status, 200, "Fixture model configuration must succeed");
  console.log(`Mira browser fixture ready on ${port}`);
} catch (error) {
  await shutdown();
  throw error;
}
