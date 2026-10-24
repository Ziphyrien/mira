#!/usr/bin/env node
/**
 * Verify the built app in a real Chrome 92 engine.
 *
 * Chrome 92 shipped in July 2021. Modern Playwright cannot drive it (the CDP
 * handshake changed), so this launches the old binary directly and speaks CDP
 * over the DevTools websocket using Node's built-in WebSocket.
 *
 * Usage:
 *   node scripts/chromium92-check.mjs [baseURL]
 *
 * The binary path comes from CHROME92_PATH, defaulting to the copy kept in
 * .pi/fabric/chrome92/chrome-win/chrome.exe.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const baseURL = process.argv[2] ?? process.env.MIRA_TEST_URL ?? "http://localhost:8791";
const binary =
  process.env.CHROME92_PATH ??
  new URL("../.pi/fabric/chrome92/chrome-win/chrome.exe", import.meta.url).pathname.replace(/^\//, "");
const port = 9333;
const evidenceDir = new URL("../.pi/fabric/chrome92/evidence/", import.meta.url).pathname.replace(/^\//, "");

if (!existsSync(binary)) {
  console.error(`Chrome 92 binary not found at ${binary}`);
  console.error("Download it from the Chromium snapshot archive, or set CHROME92_PATH.");
  process.exit(1);
}

const routes = (process.env.MIRA_CHECK_ROUTES ?? "/,/research,/admin").split(",").filter(Boolean);

const chrome = spawn(
  binary,
  [
    `--remote-debugging-port=${port}`,
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--user-data-dir=" + new URL("../.pi/fabric/chrome92/profile", import.meta.url).pathname.replace(/^\//, ""),
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);

chrome.stderr.on("data", () => {});

async function endpoint() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch {}
    await sleep(200);
  }
  throw new Error("Chrome 92 did not expose a DevTools endpoint");
}

const version = await endpoint();
console.log(`engine: ${version.Browser}`);

const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const socket = new WebSocket(webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const waiting = new Map();
const consoleErrors = [];
const pageErrors = [];

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined) {
    const pending = waiting.get(message.id);
    if (pending) {
      waiting.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    }
    return;
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error")
    consoleErrors.push(message.params.args.map((argument) => argument.value ?? argument.description ?? "").join(" "));
  if (message.method === "Runtime.exceptionThrown")
    pageErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
});

function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "evaluation failed");
  return result.result.value;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1280,
  height: 800,
  deviceScaleFactor: 1,
  mobile: false,
});
await mkdir(evidenceDir, { recursive: true });

// Establish a space first: /research and /admin redirect without one, and the
// session cookie is httpOnly, so the page itself must make the request.
await send("Page.navigate", { url: baseURL + "/" });
await sleep(2500);
const onboard = await evaluate(`fetch('/api/onboard', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Chrome 92', focus: ['work'], style: 'brief', timezone: 'Asia/Shanghai' }),
}).then(async (response) => ({ status: response.status, body: (await response.text()).slice(0, 200) }))`);
if (onboard.status !== 200) {
  console.error("could not create a space:", JSON.stringify(onboard));
  process.exit(1);
}

const report = { engine: version.Browser, baseURL, onboard, routes: {} };
let failed = false;

for (const route of routes) {
  consoleErrors.length = 0;
  pageErrors.length = 0;
  await send("Page.navigate", { url: baseURL + route });
  await sleep(3500);

  const state = await evaluate(`(() => {
    const body = document.body;
    const root = document.documentElement;
    const style = getComputedStyle(body);
    const themeVars = getComputedStyle(root);
    return {
      title: document.title,
      bodyBackground: style.backgroundColor,
      bodyColor: style.color,
      primary: themeVars.getPropertyValue('--color-primary').trim(),
      sheetRules: [...document.styleSheets].reduce((sum, sheet) => { try { return sum + sheet.cssRules.length; } catch { return sum; } }, 0),
      textLength: (body.innerText ?? '').trim().length,
      elementCount: body.querySelectorAll('*').length,
    };
  })()`);

  const shot = await send("Page.captureScreenshot", { format: "png" });
  const name =
    route === "/" ? "home" : route.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9]+/gi, "-");
  await writeFile(`${evidenceDir}${name}.png`, Buffer.from(shot.data, "base64"));

  // A themed page must resolve the custom property AND paint it; a stylesheet
  // in which Chrome 92 dropped every @layer would leave both at defaults.
  const themed = state.primary !== "" && state.bodyBackground !== "rgba(0, 0, 0, 0)";
  const painted = state.textLength > 0 && state.elementCount > 5;
  const clean = pageErrors.length === 0 && consoleErrors.length === 0;
  report.routes[route] = { ...state, themed, painted, clean, pageErrors, consoleErrors };
  if (!themed || !painted || !clean) failed = true;

  console.log(
    `${failed ? " " : "✓"} ${route} themed=${themed} painted=${painted} clean=${clean} ` +
      `bg=${state.bodyBackground} text=${state.bodyColor} primary=${state.primary} rules=${state.sheetRules}`,
  );
  for (const error of [...pageErrors, ...consoleErrors]) console.log(`    ! ${error.slice(0, 300)}`);
}

await writeFile(`${evidenceDir}report.json`, JSON.stringify(report, null, 2));
socket.close();
chrome.kill();
console.log(failed ? "\nFAILED" : "\nChrome 92 verification passed");
process.exit(failed ? 1 : 0);
