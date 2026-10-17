import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { POST } from "../../../routes/api/speech/transcribe/+server.js";

const binding = vi.hoisted(() => ({ run: vi.fn() }));
// Keep the real space.ts adapter: cancellation must reach env.AI.run's options.
vi.mock("cloudflare:workers", () => ({
  env: {
    AI: { run: binding.run },
    SPACE: {
      idFromName: (uid: string) => uid,
      get: () => ({ speechPreferences: async () => ({ voice: "冰糖", autoPlay: true }) }),
    },
  },
}));

function transcribe(signal?: AbortSignal) {
  return POST({
    request: new Request("https://mira.test/api/speech/transcribe", {
      method: "POST",
      headers: { "Content-Type": "audio/webm" },
      body: new Uint8Array([1, 2, 3]),
      signal,
    }),
    locals: { uid: "a".repeat(32), key: null },
  } as Parameters<typeof POST>[0]);
}

async function bounded<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

beforeEach(() => vi.resetAllMocks());

describe("transcription AI binding", () => {
  it("aborts pending inference at the AI binding and preserves the endpoint error policy", async () => {
    const started = Promise.withResolvers<void>();
    const inference = Promise.withResolvers<{ text: string }>();
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    let aborted = false;
    let settled = false;
    const abort = () => {
      aborted = true;
      inference.reject(signal?.reason);
    };
    binding.run.mockImplementation((_model: string, _input: unknown, options?: AiOptions) => {
      signal = options?.signal;
      signal?.addEventListener("abort", abort, { once: true });
      started.resolve();
      return inference.promise;
    });
    const pending = Promise.resolve(transcribe(controller.signal)).then(
      (response) => {
        settled = true;
        return response;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    try {
      await bounded(started.promise, "Inference did not start");
      expect(settled).toBe(false);
      controller.abort(new DOMException("Client disconnected", "AbortError"));
      expect(aborted).toBe(true);
      expect(await bounded(pending, "Aborted inference did not settle")).toMatchObject({
        status: 502,
        body: { message: "暂时无法识别语音，请稍后再试。" },
      });
    } finally {
      signal?.removeEventListener("abort", abort);
      started.resolve();
      // Also settle the old implementation's signal-less inference on a negative control.
      inference.resolve({ text: "cleanup" });
      await bounded(pending, "Inference cleanup did not settle");
    }
  });

  it("returns trimmed transcription from a successful inference", async () => {
    binding.run.mockResolvedValue({ text: "  你好  " });
    const response = await transcribe();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ text: "你好" });
  });

  it("keeps provider failures behind the existing 502 response", async () => {
    binding.run.mockRejectedValue(new Error("provider unavailable"));
    await expect(transcribe()).rejects.toMatchObject({
      status: 502,
      body: { message: "暂时无法识别语音，请稍后再试。" },
    });
  });
});
