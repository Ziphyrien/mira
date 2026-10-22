import assert from "node:assert/strict";
import { plan as researchPlan } from "../research-fixture.ts";
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
      if (
        new URL(request.url).hostname === "api.tavily.com" &&
        new URL(request.url).pathname === "/extract"
      )
        return Response.json({
          results: [
            {
              url: "https://example.org/methods",
              raw_content:
                "Pretest neutral questions in the target population, keep measurement comparable and evaluate sampling assumptions.",
            },
          ],
        });
      if (new URL(request.url).hostname === "api.tavily.com")
        return Response.json({
          results: [
            {
              title: "Research methods fixture",
              url: "https://example.org/methods",
              content: "Use neutral wording, pretesting and explicit sampling limitations.",
            },
          ],
        });
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
      if (context.includes("You coordinate research planning")) {
        const state = JSON.parse((input.messages.at(-1) as { content: string }).content) as {
          brief: { topic: string };
          exchanges: unknown[];
          sources: { url: string; access: string }[];
        };
        let action: unknown = { action: "draft" };
        if (state.brief.topic.includes("[clarify]") && !state.exchanges.length)
          action = {
            action: "clarify",
            questions: [
              { question: "你主要希望了解谁的哪类经历？", reason: "这会影响对象范围与问题措辞。" },
            ],
          };
        else if (!state.sources.length)
          action = { action: "search", query: "mixed work experience measurement" };
        else if (state.sources.some((s) => s.access === "search_excerpt"))
          action = { action: "read", urls: state.sources.map((s) => s.url) };
        chunks = [JSON.stringify(action)];
      } else if (context.includes("careful Chinese-language research design assistant")) {
        const state = JSON.parse((input.messages.at(-1) as { content: string }).content) as {
          revision?: { plan: typeof researchPlan; instruction: string };
        };
        const result = structuredClone(state.revision?.plan ?? researchPlan);
        if (state.revision) result.title = "调整后的工作体验";
        chunks = [JSON.stringify(result)];
      } else if (context.includes("You conduct a voluntary Chinese research interview")) {
        const last = input.messages.at(-1) as { content: string };
        const state = JSON.parse(last.content) as {
          remaining: string[];
          followupsUsed: number;
          answers: unknown[];
        };
        let decision: unknown = { intro: "谢谢，接下来了解另一个方面。", action: "core" };
        if (!state.remaining.length)
          decision = state.followupsUsed
            ? { intro: "谢谢你的参与。", action: "finish" }
            : {
                intro: "还有一个与刚才分享有关的小问题。",
                action: "probe",
                probe: {
                  ...researchPlan.questions[7],
                  id: "clarify",
                  prompt: "哪种情况最能解释刚才的体验？",
                  kind: "select",
                  options: [
                    { id: "focus", label: "需要专注时间" },
                    { id: "sync", label: "需要更多同步" },
                  ],
                },
              };
        chunks = [JSON.stringify(decision)];
      } else if (compacting) chunks = ["本地记忆摘要"];
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
