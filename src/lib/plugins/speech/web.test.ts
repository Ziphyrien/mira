import { createHost } from "@earendil-works/chord";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { Speech } from "./api.js";
import { speechWeb } from "./web.js";

vi.mock("#lib/plugins/speech/SpeechInput.svelte", () => ({ default: () => {} }));
vi.mock("#lib/plugins/speech/SpeechControl.svelte", () => ({ default: () => {} }));
vi.mock("#lib/plugins/speech/SpeechSettings.svelte", () => ({ default: () => {} }));
afterEach(() => vi.unstubAllGlobals());

it("closes the speech facet while native audio unlock is pending, then ignores its late completion", async () => {
  const entered = Promise.withResolvers<void>();
  const resumed = Promise.withResolvers<void>();
  const close = vi.fn(async () => {});
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "suspended";
      resume() {
        entered.resolve();
        return resumed.promise;
      }
      close = close;
    },
  );
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const host = createHost({ name: "test.speech.native", self: null });
  await host.load([speechWeb({ voice: "冰糖", autoPlay: false }, true)]);
  const speech = await host.get(Speech, {});
  const unlock = speech.unlock(null).catch(() => {});
  await entered.promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      host.close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("host waited for AudioContext.resume")), 500);
      }),
    ]);
    await unlock;
    expect(close).toHaveBeenCalledOnce();
  } finally {
    clearTimeout(timer);
    resumed.resolve();
    await unlock;
    await host.close();
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it("closes a playing speech resource, cancels its request and releases scheduled audio", async () => {
  const started = Promise.withResolvers<void>();
  const stop = vi.fn();
  const disconnect = vi.fn();
  const close = vi.fn(async () => {});
  const cancelBody = vi.fn();
  const cancelled: string[] = [];
  let requestId = "";
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      close = close;
      createBuffer(_channels: number, length: number, rate: number) {
        return { duration: length / rate, getChannelData: () => new Float32Array(length) };
      }
      createBufferSource() {
        return {
          buffer: null,
          onended: null,
          connect() {},
          start() {
            started.resolve();
          },
          stop,
          disconnect,
        };
      }
    },
  );
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (typeof init.body !== "string") throw new Error("Expected JSON");
    const input = JSON.parse(init.body) as { requestId: string };
    if (url.endsWith("/cancel")) {
      cancelled.push(input.requestId);
      return new Response(null, { status: 204 });
    }
    requestId = input.requestId;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0, 64]));
        },
        cancel: cancelBody,
      }),
    );
  });
  const host = createHost({ name: "test.speech.playing", self: null });
  await host.load([speechWeb({ voice: "冰糖", autoPlay: false }, true)]);
  const speech = await host.get(Speech, {});
  const playing = speech.play("正在播报").catch(() => {});
  try {
    await started.promise;
    await host.close();
    await playing;
    expect(cancelled).toEqual([requestId]);
    expect(stop).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(cancelBody).toHaveBeenCalledOnce();
  } finally {
    await host.close();
  }
});
