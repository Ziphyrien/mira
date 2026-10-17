import assert from "node:assert/strict";
import { ReadableStream } from "node:stream/web";
import { Response, type Request } from "miniflare";
import { createSpeechProvider } from "./speech-provider.ts";
import {
  cancellationPrompt,
  imageProfile,
  replyPrefix,
  retryPromptPrefix,
  scrollPrompt,
  richPrompt,
  richReply,
} from "./fixture.ts";

export function createProvider() {
  let sequence = 0;
  const speech = createSpeechProvider();
  const failedRequests = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  return {
    fetch: async (request: Request) => {
      if (new URL(request.url).hostname === "api.xiaomimimo.com") return speech(request);
      assert.equal(
        new URL(request.url).hostname,
        "api.deepseek.com",
        "Unexpected upstream network request",
      );
      const input = (await request.json()) as { model: string; messages: unknown[] };
      const compacting = input.model === "deepseek-v4-pro";
      assert.ok(compacting || input.model === "deepseek-flash", "Unexpected configured model");
      const context = compacting ? "" : JSON.stringify(input.messages);
      const retryKey = new RegExp(`${retryPromptPrefix} ([0-9a-f-]{36})`).exec(context)?.[1];
      if (retryKey && !failedRequests.has(retryKey)) {
        failedRequests.add(retryKey);
        return Response.json(
          {
            error: {
              message: "Synthetic request rejected",
              type: "invalid_request_error",
              code: "invalid_request_error",
            },
          },
          { status: 400 },
        );
      }
      if (context.includes(imageProfile)) {
        assert.ok(
          context.includes('"type":"image_url"'),
          "Image requests must reach the provider as image content",
        );
        assert.ok(
          context.includes("data:image/jpeg;base64,"),
          "The provider must receive the stored JPEG bytes",
        );
      }
      const hold = context.includes(cancellationPrompt);
      const long = context.includes(scrollPrompt);
      let chunks = [`${replyPrefix} ${++sequence}`];
      if (compacting) chunks = ["本地记忆摘要"];
      else if (hold) chunks = ["正在生成的片段"];
      else if (context.includes("rpc-speech "))
        chunks = [
          Array.from(context.matchAll(/rpc-speech [\da-f-]+ (?:playing|after)/g)).at(-1)![0],
        ];
      else if (context.includes(richPrompt)) chunks = richReply.match(/[\s\S]{1,45}/g)!;
      else if (long)
        chunks = Array.from(
          { length: 40 },
          (_, index) => `### 第 ${index + 1} 段\n\n${"段落文字用于验证滚动。".repeat(6)}\n\n`,
        );
      const frame = (delta: Record<string, string>, finishReason: "stop" | null) =>
        `data: ${JSON.stringify({
          id: "browser-test-completion",
          object: "chat.completion.chunk",
          created: 1700000000,
          model: input.model,
          choices: [{ index: 0, delta, finish_reason: finishReason }],
          ...(finishReason
            ? { usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } }
            : {}),
        })}\n\n`;
      const encoder = new TextEncoder();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let ended = false;
      let detach = () => {};
      const cleanup = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timers.delete(timer);
        }
        detach();
      };
      const schedule = (callback: () => void, delay: number) => {
        const pending = setTimeout(() => {
          timers.delete(pending);
          timer = undefined;
          callback();
        }, delay);
        timer = pending;
        timers.add(pending);
      };
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const close = () => {
              if (!ended) {
                ended = true;
                cleanup();
                controller.close();
              }
            };
            detach = () => request.signal.removeEventListener("abort", close);
            if (request.signal.aborted) {
              close();
              return;
            }
            request.signal.addEventListener("abort", close, { once: true });
            let index = 0;
            const next = () => {
              if (ended) return;
              if (index === chunks.length) {
                controller.enqueue(encoder.encode(frame({}, "stop") + "data: [DONE]\n\n"));
                close();
                return;
              }
              controller.enqueue(
                encoder.encode(
                  frame(
                    { ...(index === 0 ? { role: "assistant" } : {}), content: chunks[index++] },
                    null,
                  ),
                ),
              );
              if (hold) schedule(next, 30_000);
              else schedule(next, long ? 150 : 60);
            };
            next();
          },
          cancel() {
            ended = true;
            cleanup();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
    dispose() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
