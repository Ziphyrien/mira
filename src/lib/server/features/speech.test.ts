import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { POST } from "../../../routes/api/speech/+server.js";
import { POST as cancel } from "../../../routes/api/speech/cancel/+server.js";

import { openSpace, type SpaceRuntime } from "../../../../worker/core/space";
import { SpaceScope } from "../../../../worker/core/storage";
import { createTestScopePlatform } from "../../../../worker/testing/node-sqlite";

let runtime: SpaceRuntime;
vi.mock("#lib/server/space.js", () => ({
  space: () => ({
    synthesizeSpeech: (requestId: string, text: string) =>
      runtime.synthesis.synthesize({ requestId, text }),
    cancelSpeech: (requestId: string) => runtime.synthesis.cancel(requestId),
  }),
}));

beforeEach(async () => {
  runtime = await openSpace(
    new SpaceScope(createTestScopePlatform(), {
      aiConfiguration: async () => ({ keys: { mimo: "test-key" }, chat: null, memory: null }),
      chatModel: async () => null,
      touch: async () => {},
      remove: async () => {},
    }),
    () => {},
  );
  await runtime.account.configure({
    uid: "test",
    input: { name: "语音验收", focus: [], style: "balanced", timezone: "UTC" },
  });
});

afterEach(async () => {
  await runtime?.close();
  vi.unstubAllGlobals();
});

function request(text: string, requestId = crypto.randomUUID()) {
  return POST({
    request: new Request("http://probe/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, text }),
    }),
    locals: { uid: "test", key: null },
  } as Parameters<typeof POST>[0]);
}

async function bounded<T>(promise: PromiseLike<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function stop(requestId: string) {
  return cancel({
    request: new Request("http://probe/api/speech/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    }),
    locals: { uid: "test", key: null },
  } as Parameters<typeof cancel>[0]);
}

describe("speech cancellation", () => {
  it("honors a stop received before synthesis starts", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const requestId = crypto.randomUUID();
    expect((await stop(requestId)).status).toBe(204);
    await expect(request("已经停止的播报", requestId)).rejects.toMatchObject({ status: 409 });
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each(["loading", "playing", "backpressure"] as const)(
    "stops A while %s and plays all of B without finishing A",
    async (phase) => {
      const firstStarted = Promise.withResolvers<void>(),
        firstClosed = Promise.withResolvers<void>();
      const finishFirst = Promise.withResolvers<void>();
      const received: { messages: { content: string }[] }[] = [];
      const pcm = Buffer.from([0, 0, 0, 64, 0, 192]);
      const frame =
        "data: " +
        JSON.stringify({ choices: [{ delta: { audio: { data: pcm.toString("base64") } } }] }) +
        "\n\n";
      const done = "data: [DONE]\n\n";
      const provider = createServer(async (req, res) => {
        let body = "";
        for await (const chunk of req) body += chunk;
        received.push(JSON.parse(body));
        if (received.length === 1) {
          res.on("close", () => firstClosed.resolve());
          if (phase !== "loading") {
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            res.write(phase === "backpressure" ? frame + frame : frame);
          }
          firstStarted.resolve();
          await finishFirst.promise;
        }
        if (!res.destroyed) {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.end(frame + frame + frame + done);
        }
      });
      provider.listen(0, "127.0.0.1");
      await once(provider, "listening");
      const address = provider.address();
      if (!address || typeof address === "string") throw new Error("Missing provider listener");
      const realFetch = globalThis.fetch;
      vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
        let url: string;
        if (typeof input === "string") url = input;
        else if (input instanceof URL) url = input.href;
        else url = input.url;
        return realFetch(
          url.startsWith("https://api.xiaomimimo.com/")
            ? `http://127.0.0.1:${address.port}/speech`
            : input,
          init,
        );
      });
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const requestId = crypto.randomUUID();
        const response = await bounded(
          Promise.resolve(request("这是**旧播报。**停止", requestId)),
          "Cannot stop while waiting for provider response headers",
        );
        reader = response.body!.getReader();
        const firstRead = reader.read();
        await bounded(firstStarted.promise, "Provider did not receive A");
        if (phase !== "loading")
          expect(Buffer.from((await bounded(firstRead!, "A did not start")).value!)).toEqual(pcm);
        if (phase === "backpressure") expect((await stop(requestId)).status).toBe(204);
        else await bounded(reader.cancel("user stopped A"), "Stopping A blocks on its completion");
        await bounded(firstClosed.promise, "Stop did not close the unfinished provider connection");
        if (phase === "loading") expect((await firstRead!).done).toBe(true);
        const next = await bounded(
          Promise.resolve(request("这是**新播报。**继续")),
          "B waits for A to finish",
        );
        expect(
          Buffer.from(await bounded(next.arrayBuffer(), "B is interrupted before completion")),
        ).toEqual(Buffer.concat([pcm, pcm, pcm]));
        expect(received[0].messages[0].content).toBe("这是旧播报。停止");
        expect(received[1].messages[0].content).toBe("这是新播报。继续");
        await bounded(
          runtime.close(),
          "Stopping speech leaves the account waiting for a blocked output",
        );
        await reader.cancel().catch(() => {});
      } finally {
        await reader?.cancel().catch(() => {});
        reader?.releaseLock();
        finishFirst.resolve();
        provider.closeAllConnections();
        provider.close();
      }
    },
  );
});
