import { Buffer } from "node:buffer";

/** Decode provider frames inside the account DO; RPC carries only the resulting PCM bytes. */
export function createSpeechStream(
  text: string,
  voice: string,
  key: string,
  lifetime: AbortSignal,
) {
  const upstreamController = new AbortController();
  const signal = AbortSignal.any([
    lifetime,
    upstreamController.signal,
    AbortSignal.timeout(90_000),
  ]);
  let detach = () => {};
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      // Error both ends so cancellation also releases a write blocked by a paused consumer.
      const abort = () => controller.error(new Error("语音生成中断，请重新播放。"));
      if (signal.aborted) abort();
      else {
        signal.addEventListener("abort", abort, { once: true });
        detach = () => signal.removeEventListener("abort", abort);
      }
    },
  });
  const writer = writable.getWriter();
  // Native stream cancellation can interrupt fetch even while it is waiting for the next frame.
  void writer.closed.catch((reason: unknown) => upstreamController.abort(reason));
  const completion = (async () => {
    let reader: ReadableStreamDefaultReader<string> | undefined;
    try {
      const upstream = await fetch("https://api.xiaomimimo.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          model: "mimo-v2.5-tts",
          messages: [{ role: "assistant", content: text }],
          audio: { format: "pcm16", voice },
          stream: true,
        }),
      });
      if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel();
        throw new Error("Speech generation failed");
      }
      reader = upstream.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        signal.throwIfAborted();
        const newline = buffer.indexOf("\n");
        if (newline < 0) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          if (buffer.length > 1024 * 1024) throw new Error("Audio frame is too large");
          continue;
        }
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") break;
        const frame = JSON.parse(data) as {
          error?: unknown;
          choices?: { delta?: { audio?: { data?: string } } }[];
        };
        if (frame.error) throw new Error("Speech generation failed");
        const encoded = frame.choices?.[0]?.delta?.audio?.data;
        if (encoded) await writer.write(new Uint8Array(Buffer.from(encoded, "base64")));
      }
      await writer.close();
    } catch {
      await writer.abort(new Error("语音生成中断，请重新播放。"));
    } finally {
      detach();
      upstreamController.abort();
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      writer.releaseLock();
    }
  })();
  return { audio: readable, completion };
}
