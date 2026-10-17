import { createActor, waitFor } from "xstate";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  THINKING,
  type AiModelInfo,
  ChatInput,
  type Row,
  type StreamEvent,
} from "#lib/contracts/index.js";
import { ConversationController } from "#lib/plugins/conversation/controller.js";
import { createChatMachine, type CompletedChatReply } from "#lib/plugins/conversation/machine.js";
import type { ConversationTransport } from "#lib/plugins/conversation/transport.js";

const encoder = new TextEncoder();

function streamFromChunks(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

function streamFromEvents(
  events: StreamEvent[],
  trailingNewline = true,
): ReadableStream<Uint8Array> {
  const payload =
    events.map((event) => JSON.stringify(event)).join("\n") + (trailingNewline ? "\n" : "");
  return streamFromChunks([payload]);
}

describe("ConversationController & chatMachine", () => {
  const levels = THINKING.map((item) => item.id);
  const baseModel = { provider: "radius", modelId: "balanced" } as const;

  it.each<ChatInput["prompt"]>([
    { kind: "message", text: "你好" },
    { kind: "reply", replyId: 2 },
    { kind: "question", userId: 1 },
  ])(
    "serializes the displayed model for a $kind prompt accepted by the HTTP contract",
    async (prompt) => {
      const displayedModel: AiModelInfo = {
        ...baseModel,
        name: "测试模型",
        thinking: [...levels],
        highest: "max",
        supportsImages: true,
      };
      const requests: unknown[] = [];
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
        const request = new Request(
          url instanceof Request ? url : new URL(url, "https://mira.test"),
          init,
        );
        expect(request.url).toBe("https://mira.test/api/chat");
        expect(request.method).toBe("POST");
        const input: unknown = await request.json();
        requests.push(input);
        if (!ChatInput.safeParse(input).success) {
          return Response.json({ message: "消息格式不正确" }, { status: 400 });
        }
        return new Response(
          streamFromEvents([
            { type: "done", text: "收到", at: 1, userId: 1, replyId: 2, messages: [] },
          ]),
        );
      });
      const onDone = vi.fn();
      const controller = new ConversationController({ onDone });
      try {
        if (prompt.kind === "message") {
          controller.send({ text: prompt.text, thinking: "high", model: displayedModel });
        } else {
          controller.regenerate({ prompt, thinking: "high", model: displayedModel });
        }
        await vi.waitFor(() => expect(controller.snapshot.matches("streaming")).toBe(false));
        expect(controller.snapshot.context.error).toBe("");
        expect(requests).toEqual([
          { prompt, thinking: "high", model: baseModel, requestId: expect.any(String) },
        ]);
        expect(onDone).toHaveBeenCalledOnce();
      } finally {
        controller.dispose();
        fetchMock.mockRestore();
      }
    },
  );

  it.each(levels)(
    "sends %s, preserves manual choice when model is unchanged, and keeps logical requestId across retry",
    async (thinking) => {
      const image = thinking === "high" ? "9a64e682-f2e8-4dbb-8dcc-9e20e22189c8" : undefined;
      const requests: ChatInput[] = [];
      let callCount = 0;

      const transport: ConversationTransport = {
        stream: vi.fn(async (input) => {
          requests.push(input);
          callCount += 1;
          if (callCount === 1) {
            return streamFromEvents([
              {
                type: "model",
                model: {
                  ...baseModel,
                  name: "测试模型",
                  thinking: [...levels],
                  highest: "max",
                  supportsImages: true,
                },
              },
              { type: "error", message: "暂时不可用" },
            ]);
          }
          return streamFromEvents([
            {
              type: "done",
              text: "完成",
              at: 1,
              userId: 1,
              replyId: 2,
              messages: [],
            },
          ]);
        }),
        cancel: vi.fn(async () => ({ messages: [] })),
      };

      const actor = createActor(createChatMachine({ transport })).start();
      try {
        actor.send({
          type: "SEND",
          text: "你好",
          ...(image ? { image } : {}),
          thinking,
          model: baseModel,
        });
        await waitFor(actor, (state) => state.matches("failed"));
        actor.send({ type: "RETRY" });
        await waitFor(actor, (state) => state.matches("idle"));

        expect(requests).toHaveLength(2);
        expect(requests[1].requestId).toBe(requests[0].requestId);
        for (const req of requests) {
          expect(req).toEqual({
            prompt: { kind: "message", text: "你好", ...(image ? { image } : {}) },
            thinking,
            model: baseModel,
            requestId: expect.any(String),
          });
        }
      } finally {
        actor.stop();
      }
    },
  );

  it("uses the new model and resets thinking on retry after an admin model change", async () => {
    const updatedModel = { provider: "deepseek", modelId: "deepseek-v4-pro" } as const;
    const requests: ChatInput[] = [];
    let callCount = 0;

    const transport: ConversationTransport = {
      stream: vi.fn(async (input) => {
        requests.push(input);
        callCount += 1;
        if (callCount === 1) {
          return streamFromEvents([
            {
              type: "model",
              model: {
                ...updatedModel,
                name: "DeepSeek",
                thinking: ["off", "high", "max"],
                highest: "max",
                supportsImages: false,
              },
            },
            { type: "error", message: "模型已更新，请重试。" },
          ]);
        }
        return streamFromEvents([
          {
            type: "done",
            text: "完成",
            at: 1,
            userId: 1,
            replyId: 2,
            messages: [],
          },
        ]);
      }),
      cancel: vi.fn(async () => ({ messages: [] })),
    };

    const actor = createActor(createChatMachine({ transport })).start();
    try {
      actor.send({ type: "SEND", text: "你好", thinking: "low", model: baseModel });
      await waitFor(actor, (state) => state.matches("failed"));
      actor.send({ type: "RETRY" });
      await waitFor(actor, (state) => state.matches("idle"));

      expect(requests).toHaveLength(2);
      expect(requests[1].requestId).toBe(requests[0].requestId);
      expect(requests[1]).toEqual({
        prompt: { kind: "message", text: "你好" },
        thinking: "high",
        model: updatedModel,
        requestId: requests[0].requestId,
      });
    } finally {
      actor.stop();
    }
  });

  it("preserves logical requestId across resume, restoreFailed, and regenerate retries without idle I/O", async () => {
    const requests: ChatInput[] = [];
    let shouldFail = true;

    const transport: ConversationTransport = {
      stream: vi.fn(async (input) => {
        requests.push(input);
        if (shouldFail) {
          return streamFromEvents([{ type: "error", message: "网络波动" }]);
        }
        return streamFromEvents([
          {
            type: "done",
            text: "恢复成功",
            at: 10,
            userId: 3,
            replyId: 4,
            messages: [{ i: 4, kind: "mira", text: "恢复成功", at: 10 }],
          },
        ]);
      }),
      cancel: vi.fn(async () => ({ messages: [] })),
    };

    const controller = new ConversationController({ transport });
    expect(controller.snapshot.matches("idle")).toBe(true);
    expect(transport.stream).not.toHaveBeenCalled();

    const resumedRequest: ChatInput = {
      prompt: { kind: "message", text: "继续生成" },
      requestId: "resume_req_12345",
      thinking: "high",
      model: baseModel,
    };

    controller.resume(resumedRequest);
    await vi.waitFor(() => expect(controller.snapshot.matches("failed")).toBe(true));
    expect(requests[0].requestId).toBe("resume_req_12345");

    shouldFail = false;
    controller.retry();
    await vi.waitFor(() => expect(controller.snapshot.matches("idle")).toBe(true));
    expect(requests[1].requestId).toBe("resume_req_12345");

    const failedRequest: ChatInput = {
      prompt: { kind: "reply", replyId: 8 },
      requestId: "restored_failed_99",
      thinking: "medium",
      model: baseModel,
    };
    controller.restoreFailed(failedRequest, "上次未完成");
    expect(controller.snapshot.matches("failed")).toBe(true);
    expect(controller.snapshot.context.error).toBe("上次未完成");
    expect(transport.stream).toHaveBeenCalledTimes(2);

    controller.retry();
    await vi.waitFor(() => expect(controller.snapshot.matches("idle")).toBe(true));
    expect(requests[2].requestId).toBe("restored_failed_99");

    shouldFail = true;
    controller.regenerate({
      prompt: { kind: "question", userId: 7 },
      thinking: "high",
      model: baseModel,
    });
    await vi.waitFor(() => expect(controller.snapshot.matches("failed")).toBe(true));
    const regenId = requests[3].requestId;

    shouldFail = false;
    controller.retry();
    await vi.waitFor(() => expect(controller.snapshot.matches("idle")).toBe(true));
    expect(requests[4].requestId).toBe(regenId);

    controller.dispose();
  });

  it("parses split NDJSON chunks, multi-byte boundaries, and a valid unterminated final line", async () => {
    const models: Array<AiModelInfo | null> = [];
    const messageUpdates: Row[][] = [];
    const completions: CompletedChatReply[] = [];

    const line1 = JSON.stringify({
      type: "model",
      model: {
        ...baseModel,
        name: "Radius",
        thinking: ["off", "high"],
        highest: "high",
        supportsImages: true,
      },
    });
    const line2 = JSON.stringify({ type: "status", phase: "recall" });
    const line3 = JSON.stringify({ type: "thinking", text: "先回想", replace: false });
    const line4 = JSON.stringify({ type: "thinking", text: "完整思考", replace: true });
    const line5 = JSON.stringify({
      type: "search",
      search: { id: "s1", query: "Mira", status: "running", sources: [] },
    });
    const line6 = JSON.stringify({
      type: "search",
      search: {
        id: "s1",
        query: "Mira",
        status: "done",
        sources: [{ id: "src1", url: "https://example.com", title: "Ex", excerpt: "..." }],
      },
    });
    const line7 = JSON.stringify({ type: "delta", text: "你好，世界🙂" });
    const finalUnterminated = JSON.stringify({
      type: "done",
      text: "你好，世界🙂",
      thinking: "完整思考",
      at: 42,
      userId: 1,
      replyId: 2,
      messages: [
        { i: 1, kind: "user", text: "hi", at: 40 },
        { i: 2, kind: "mira", text: "你好，世界🙂", thinking: "完整思考", at: 42 },
      ],
    });

    const fullPayload = encoder.encode(
      [line1, line2, line3, line4, line5, line6, line7].join("\n") + "\n" + finalUnterminated,
    );
    // Split across arbitrary byte offsets including inside multi-byte UTF-8 sequences
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < fullPayload.length; i += 13) {
      chunks.push(fullPayload.slice(i, i + 13));
    }

    const transport: ConversationTransport = {
      stream: vi.fn(async () => streamFromChunks(chunks)),
      cancel: vi.fn(async () => ({ messages: [] })),
    };

    const controller = new ConversationController({
      transport,
      onModel: (m) => models.push(m),
      onMessages: (rows) => messageUpdates.push(rows),
      onDone: (reply) => completions.push(reply),
    });

    controller.send({ text: "hi", thinking: "high", model: baseModel });
    await vi.waitFor(() => expect(controller.snapshot.matches("idle")).toBe(true));

    expect(models).toHaveLength(1);
    expect(models[0]?.name).toBe("Radius");
    expect(messageUpdates).toHaveLength(1);
    expect(messageUpdates[0]).toHaveLength(2);
    expect(completions).toHaveLength(1);
    expect(completions[0].text).toBe("你好，世界🙂");
    expect(completions[0].thinking).toBe("完整思考");

    controller.dispose();
  });

  it("rejects oversized NDJSON frames and reports premature stream EOF", async () => {
    let mode: "oversized" | "truncated" = "oversized";
    const transport: ConversationTransport = {
      stream: vi.fn(async () => {
        if (mode === "oversized") {
          return streamFromChunks([
            JSON.stringify({ type: "delta", text: "x".repeat(16 * 1024 * 1024) }) + "\n",
            JSON.stringify({
              type: "done",
              text: "done",
              at: 1,
              userId: 1,
              replyId: 2,
              messages: [],
            }) + "\n",
          ]);
        }
        return streamFromChunks([JSON.stringify({ type: "delta", text: "半截回复" })]);
      }),
      cancel: vi.fn(async () => ({ messages: [] })),
    };

    const controller = new ConversationController({
      transport,
    });

    controller.send({ text: "test", thinking: "high", model: baseModel });
    await vi.waitFor(() => expect(controller.snapshot.matches("failed")).toBe(true));
    expect(controller.snapshot.context.error).toBe("响应数据帧过大，连接已中断。");

    controller.dismiss();
    expect(controller.snapshot.matches("idle")).toBe(true);

    mode = "truncated";
    controller.send({ text: "test2", thinking: "high", model: baseModel });
    await vi.waitFor(() => expect(controller.snapshot.matches("failed")).toBe(true));
    expect(controller.snapshot.context.error).toBe("连接中断了，回复可能仍在生成，稍后刷新看看。");

    controller.dispose();
  });

  it("cancels reader on dispose and coordinates stop() with requestId fencing", async () => {
    let streamCanceled = false;
    let resolveCancel!: (value: { messages: Row[] }) => void;
    const cancelSignals: AbortSignal[] = [];
    const canceledIds: string[] = [];
    const receivedMessages: Row[][] = [];

    const transport: ConversationTransport = {
      stream: vi.fn(async () => {
        return new ReadableStream<Uint8Array>({
          start(ctrl) {
            ctrl.enqueue(
              encoder.encode(JSON.stringify({ type: "delta", text: "正在生成" }) + "\n"),
            );
          },
          cancel() {
            streamCanceled = true;
          },
        });
      }),
      cancel: vi.fn((input, signal) => {
        canceledIds.push(input.requestId);
        if (signal) cancelSignals.push(signal);
        return new Promise<{ messages: Row[] }>((resolve) => {
          resolveCancel = resolve;
        });
      }),
    };

    const controller = new ConversationController({
      transport,
      onMessages: (rows) => receivedMessages.push(rows),
    });

    controller.send({ text: "停一下", thinking: "high", model: baseModel });
    await vi.waitFor(() => expect(controller.snapshot.context.text).toBe("正在生成"));

    const activeRequestId = controller.snapshot.context.request?.requestId;
    expect(activeRequestId).toBeTruthy();

    const stopPromise = controller.stop();
    expect(controller.snapshot.stopping).toBe(true);
    expect(canceledIds).toEqual([activeRequestId]);
    expect(cancelSignals[0]?.aborted).toBe(false);

    const stoppedRows: Row[] = [{ i: 10, kind: "mira", text: "正在生成", stopped: true, at: 50 }];
    resolveCancel({ messages: stoppedRows });
    await stopPromise;

    expect(controller.snapshot.stopping).toBe(false);
    expect(controller.snapshot.matches("idle")).toBe(true);
    expect(controller.snapshot.context.stopped).toBe(true);
    expect(receivedMessages).toEqual([stoppedRows]);
    expect(streamCanceled).toBe(true);

    // Verify dispose aborts in-flight stream and ignores stale stop completion
    streamCanceled = false;
    controller.send({ text: "第二次", thinking: "high", model: baseModel });
    await vi.waitFor(() => expect(controller.snapshot.matches("streaming")).toBe(true));

    const secondStop = controller.stop();
    controller.dispose();
    expect(streamCanceled).toBe(true);
    expect(cancelSignals[1]?.aborted).toBe(true);

    resolveCancel({ messages: [{ i: 99, kind: "mira", text: "stale", at: 99 }] });
    await secondStop;
    expect(receivedMessages).toHaveLength(1);
  });
});
