import assert from "node:assert/strict";
import { ReadableStream } from "node:stream/web";
import { Response, type Request } from "miniflare";

/** Controlled provider events verify cancellation across the actual Worker/DO RPC boundary. */
export function createSpeechProvider() {
  const sessions = new Map<
    string,
    {
      started: ReturnType<typeof Promise.withResolvers<void>>;
      cancelled: ReturnType<typeof Promise.withResolvers<void>>;
    }
  >();
  return async (request: Request) => {
    const input = (await request.json()) as {
      model: string;
      messages: { content: string }[];
      audio: { format: string; voice: string };
    };
    assert.equal(input.model, "mimo-v2.5-tts");
    assert.equal(input.audio.format, "pcm16");
    assert.equal(request.headers.get("authorization"), "Bearer synthetic-speech-key");
    const encode = (bytes: Uint8Array) =>
      new TextEncoder().encode(
        `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: Buffer.from(bytes).toString("base64") } } }] })}\n\n`,
      );
    // Ordinary conversation tests exercise autoplay with the account's configured voice.
    if (!input.messages[0].content.includes("rpc-speech "))
      return new Response(encode(new Uint8Array([0, 0])), {
        headers: { "Content-Type": "text/event-stream" },
      });
    assert.equal(input.audio.voice, "Mia");
    const match = /^rpc-speech ([\da-f-]+) (loading|playing|ready|after)$/.exec(
      input.messages[0].content,
    );
    assert.ok(match, "DO must strip Markdown before sending speech to the provider");
    const [, id, phase] = match;
    let session = sessions.get(id);
    if (!session) {
      session = {
        started: Promise.withResolvers<void>(),
        cancelled: Promise.withResolvers<void>(),
      };
      sessions.set(id, session);
    }
    const bounded = async (event: Promise<void>) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          event,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Speech RPC lifecycle did not propagate")),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    if (phase === "ready") {
      await bounded(session.started.promise);
      return new Response(encode(new Uint8Array([0, 0])), {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    if (phase === "loading") {
      const cancelled = session.cancelled;
      if (request.signal.aborted) cancelled.resolve();
      else request.signal.addEventListener("abort", () => cancelled.resolve(), { once: true });
      session.started.resolve();
      await bounded(cancelled.promise);
      return new Response(null, { status: 499 });
    }
    if (phase === "playing") {
      const cancelled = session.cancelled;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encode(new Uint8Array([0, 0, 0, 64])));
            request.signal.addEventListener("abort", () => cancelled.resolve(), { once: true });
            session.started.resolve();
          },
          cancel() {
            cancelled.resolve();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    }
    await bounded(session.cancelled.promise);
    sessions.delete(id);
    let index = 0;
    let remainder: Uint8Array | undefined;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (remainder) {
            controller.enqueue(remainder);
            remainder = undefined;
          } else if (index < 12) {
            const bytes = Uint8Array.from(
              { length: 48_000 },
              (_, offset) => (offset + index * 31) % 256,
            );
            index++;
            const frame = encode(bytes);
            // Split inside JSON to cover transport chunking independently of SSE frame boundaries.
            controller.enqueue(frame.slice(0, 23));
            remainder = frame.slice(23);
          } else {
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            controller.close();
          }
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
}
