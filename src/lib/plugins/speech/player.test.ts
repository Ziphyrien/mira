import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SpeechPlayer } from "#lib/plugins/speech/player.svelte.js";
class Source {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  connect() {}
  start() {
    Audio.sources.push(this);
    Audio.started(this);
    if (Audio.autoEnd) queueMicrotask(() => this.onended?.());
  }
  stop = vi.fn();
  disconnect = vi.fn();
}
class Audio {
  static sources: Source[] = [];
  static autoEnd = true;
  static started = (_source: Source) => {};
  static resumeWork: Promise<void> = Promise.resolve();
  static resumeEntered = () => {};
  state = "running";
  currentTime = 0;
  destination = {};
  resume() {
    Audio.resumeEntered();
    return Audio.resumeWork;
  }
  close() {
    return Promise.resolve();
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    return new Source();
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  Audio.sources = [];
  Audio.autoEnd = true;
  Audio.started = () => {};
  Audio.resumeWork = Promise.resolve();
  Audio.resumeEntered = () => {};
});
function audio() {
  vi.stubGlobal("AudioContext", Audio);
}
describe("speech playback native boundary", () => {
  it("awaits visible Markdown extraction and sends bounded text chunks, never a Promise object", async () => {
    audio();
    const texts: string[] = [];
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init: RequestInit) => {
      if (typeof init.body !== "string") throw new Error("Speech must send a JSON string body");
      texts.push((JSON.parse(init.body) as { text: string }).text);
      return new Response(new Uint8Array([0, 0]));
    });
    const player = new SpeechPlayer();
    try {
      await player.play(`**中文。**${"A".repeat(1050)} [1](cite:abcdefghijklmnop)`);
      expect(texts.length).toBeGreaterThan(1);
      expect(texts.every((text) => typeof text === "string" && text.length <= 500)).toBe(true);
      expect(texts.join("")).toBe(`中文。${"A".repeat(1050)}`);
    } finally {
      player.dispose();
    }
  });
  it("does not start a network request when playback was stopped during audio unlock", async () => {
    audio();
    const resumed = Promise.withResolvers<void>();
    Audio.resumeWork = resumed.promise;
    const entered = Promise.withResolvers<void>();
    Audio.resumeEntered = entered.resolve;
    const fetcher = vi.fn(async () => new Response(new Uint8Array([0, 0])));
    vi.stubGlobal("fetch", fetcher);
    const player = new SpeechPlayer();
    try {
      const playing = player.play("a reply");
      await entered.promise;
      player.stop();
      resumed.resolve();
      await playing;
      expect(fetcher).not.toHaveBeenCalled();
      expect(player.active).toBe(false);
    } finally {
      player.dispose();
    }
  });
  it("stops a pending provider request with a separate cancellation command", async () => {
    audio();
    const started = Promise.withResolvers<string>();
    const stopped: string[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      if (typeof init.body !== "string") throw new Error("Speech must send a JSON string body");
      const input = JSON.parse(init.body) as { requestId: string };
      if (url === "/api/speech/cancel") {
        stopped.push(input.requestId);
        expect(init.signal).toBeUndefined();
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      const response = new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      });
      started.resolve(input.requestId);
      return response;
    });
    const player = new SpeechPlayer();
    try {
      const playback = player.play("等待首包");
      const requestId = await started.promise;
      player.stop();
      await playback;
      expect(stopped).toEqual([requestId]);
      expect(player.active).toBe(false);
      expect(player.error).toBe("");
    } finally {
      player.dispose();
    }
  });
  it("stays active after synthesis ends until the last scheduled audio finishes", async () => {
    audio();
    Audio.autoEnd = false;
    const started = Promise.withResolvers<Source>();
    Audio.started = started.resolve;
    const response = new Response(new Uint8Array([0, 64]));
    vi.stubGlobal("fetch", async () => response);
    const player = new SpeechPlayer();
    let finished = false;
    try {
      const playing = player.play("完整播放").then(() => {
        finished = true;
      });
      const source = await started.promise;
      await expect.poll(() => response.body!.locked).toBe(false);
      expect(player.active).toBe(true);
      expect(finished).toBe(false);
      source.onended?.();
      await playing;
      expect(player.active).toBe(false);
      expect(source.disconnect).toHaveBeenCalledOnce();
      expect(source.stop).not.toHaveBeenCalled();
    } finally {
      player.dispose();
    }
  });
  it.each(["response", "error"] as const)(
    "ignores an old request's late %s after replacing playback",
    async (late) => {
      audio();
      Audio.autoEnd = false;
      const firstStarted = Promise.withResolvers<string>();
      const oldResponse = Promise.withResolvers<Response>();
      const secondStarted = Promise.withResolvers<Source>();
      const discarded = vi.fn();
      const cancelled: string[] = [];
      Audio.started = secondStarted.resolve;
      vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
        if (typeof init.body !== "string") throw new Error("Expected JSON");
        const input = JSON.parse(init.body) as { requestId: string; text?: string };
        if (url.endsWith("/cancel")) {
          cancelled.push(input.requestId);
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        if (input.text === "旧播报") {
          firstStarted.resolve(input.requestId);
          return oldResponse.promise;
        }
        return Promise.resolve(new Response(new Uint8Array([0, 64])));
      });
      const player = new SpeechPlayer();
      try {
        const first = player.play("旧播报");
        const oldId = await firstStarted.promise;
        const second = player.play("新播报");
        await first;
        const source = await secondStarted.promise;
        expect(cancelled).toEqual([oldId]);
        if (late === "response") {
          oldResponse.resolve(new Response(new ReadableStream<Uint8Array>({ cancel: discarded })));
          await expect.poll(() => discarded.mock.calls.length).toBe(1);
        } else {
          oldResponse.reject(new Error("旧请求失败"));
          await oldResponse.promise.catch(() => {});
        }
        expect(player.error).toBe("");
        expect(player.active).toBe(true);
        expect(source.stop).not.toHaveBeenCalled();
        expect(Audio.sources).toHaveLength(1);
        source.onended?.();
        await second;
        expect(player.active).toBe(false);
      } finally {
        player.dispose();
      }
    },
  );
  it("reports an incomplete PCM sample and releases playback after invalid audio", async () => {
    audio();
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1])));
    const player = new SpeechPlayer();
    try {
      await player.play("a reply");
      expect(player.error).toContain("不完整");
      expect(player.active).toBe(false);
    } finally {
      player.dispose();
    }
  });
});
