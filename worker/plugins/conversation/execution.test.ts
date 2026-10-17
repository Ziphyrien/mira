import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { Harness } from "@earendil-works/pi-durable";
import { openSpace } from "../../core/space";
import { SpaceScope, type DirectoryPort } from "../../core/storage";
import { createTestScopePlatform } from "../../testing/node-sqlite";
import { createModelRegistry, describeModel } from "../models/catalog";
import type { ChatInput, StreamEvent } from "../../../src/lib/contracts";
const choice = { provider: "deepseek" as const, modelId: "deepseek-flash" };
const info = describeModel(createModelRegistry({ deepseek: "synthetic-key" }), choice);
const input: ChatInput = {
  requestId: "synthetic-request-1",
  prompt: { kind: "message", text: "hello" },
  thinking: "off",
  model: choice,
};
function directory(): DirectoryPort {
  return {
    aiConfiguration: async () => ({
      keys: { deepseek: "synthetic-key" },
      chat: choice,
      memory: null,
    }),
    chatModel: async () => info,
    touch: async () => {},
    remove: async () => {},
  };
}
function upstream(
  onRequest: () => void,
  gate: Promise<void>,
  count: { value: number },
  onStream?: (append: (text: string) => void) => void,
) {
  vi.stubGlobal("fetch", async (request: RequestInfo | URL, init?: RequestInit) => {
    let url: string;
    if (typeof request === "string") url = request;
    else if (request instanceof URL) url = request.href;
    else url = request.url;
    if (new URL(url).hostname !== "api.deepseek.com") throw new Error(`Unexpected network: ${url}`);
    if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
    const body = JSON.parse(init.body) as {
      tools: { function: { name: string } }[];
      messages: { role: string; content: string | { type: string; text?: string }[] }[];
    };
    expect(body.tools.map((tool) => tool.function.name)).toEqual(
      expect.arrayContaining(["zoom", "date", "tavily_search"]),
    );
    expect(body.messages.find((message) => message.role === "system")?.content).toContain(
      "Synthetic",
    );
    const content = body.messages.find((message) => message.role === "user")?.content;
    expect(
      typeof content === "string" ? content : content?.map((part) => part.text ?? "").join(""),
    ).toContain("<chat>");
    count.value++;
    onRequest();
    const encoder = new TextEncoder();
    const frame = (delta: Record<string, unknown>, finish_reason: string | null) =>
      `data: ${JSON.stringify({ id: "synthetic-completion", object: "chat.completion.chunk", created: 1700000000, model: choice.modelId, choices: [{ index: 0, delta, finish_reason }], ...(finish_reason ? { usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } } : {}) })}\n\n`;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          let ended = false;
          const finish = () => {
            if (ended) return;
            ended = true;
            controller.close();
          };
          const signal = init?.signal;
          signal?.addEventListener("abort", finish, { once: true });
          controller.enqueue(
            encoder.encode(frame({ role: "assistant", content: "synthetic answer" }, null)),
          );
          onStream?.((text) => controller.enqueue(encoder.encode(frame({ content: text }, null))));
          void gate
            .then(() => {
              if (ended) return;
              controller.enqueue(encoder.encode(frame({}, "stop") + "data: [DONE]\n\n"));
              finish();
            })
            .catch((error) => {
              if (!ended) controller.error(error);
            });
        },
        cancel() {},
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
}
async function expectWitness(work: Promise<void>, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const observed = await Promise.race([
      work.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 2000);
      }),
    ]);
    expect(observed, message).toBe(true);
  } finally {
    clearTimeout(timer);
  }
}
async function collect(stream: ReadableStream<Uint8Array>, witness?: (event: StreamEvent) => void) {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  const events: StreamEvent[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as StreamEvent;
        events.push(event);
        witness?.(event);
      }
    }
    return events;
  } finally {
    reader.releaseLock();
  }
}
const imageChoice = { provider: "radius" as const, modelId: "gpt-6-sol" };
const imageInfo = describeModel(createModelRegistry({ radius: "synthetic-key" }), imageChoice);
const radiusDirectory = (): DirectoryPort => ({
  ...directory(),
  aiConfiguration: async () => ({
    keys: { radius: "synthetic-key" },
    chat: imageChoice,
    memory: null,
  }),
  chatModel: async () => imageInfo,
});
const usage: AssistantMessage["usage"] = {
  input: 100,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 105,
  cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
};
function radiusUpstream(
  reply: (
    messages: Message[],
    signal?: AbortSignal | null,
    options?: { toolChoice?: string; sessionId?: string; reasoning?: string },
  ) => Response,
) {
  vi.stubGlobal("fetch", async (request: RequestInfo | URL, init?: RequestInit) => {
    let href: string;
    if (typeof request === "string") href = request;
    else if (request instanceof URL) href = request.href;
    else href = request.url;
    const url = new URL(href);
    if (url.href !== "https://radius.pi.dev/v1/messages")
      throw new Error(`Unexpected network: ${url}`);
    if (typeof init?.body !== "string") throw new Error("Missing provider body");
    const body = JSON.parse(init.body) as {
      context: { messages: Message[] };
      options: { toolChoice?: string; sessionId?: string; reasoning?: string };
    };
    return reply(body.context.messages, init.signal, body.options);
  });
}
function radiusResponse(
  text: string,
  gate = Promise.resolve(),
  failure = false,
  signal?: AbortSignal | null,
) {
  const encoder = new TextEncoder();
  const frame = (event: unknown) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        let ended = false;
        const close = () => {
          if (!ended) {
            ended = true;
            controller.close();
          }
        };
        signal?.addEventListener("abort", close, { once: true });
        controller.enqueue(frame({ type: "text_start", contentIndex: 0 }));
        controller.enqueue(frame({ type: "text_delta", contentIndex: 0, delta: text }));
        void gate.then(() => {
          if (ended) return;
          controller.enqueue(
            frame(
              failure
                ? { type: "error", reason: "error", usage, errorMessage: "503 service unavailable" }
                : { type: "done", reason: "stop", usage },
            ),
          );
          close();
        });
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("actual durable generation ownership", () => {
  it.each(["shared", "separate"] as const)(
    "keeps %s prompt and cache identities stable across compaction retries",
    async (mode) => {
      const platform = createTestScopePlatform();
      const requests: {
        compact: boolean;
        messages: Message[];
        toolChoice?: string;
        sessionId?: string;
        reasoning?: string;
      }[] = [];
      radiusUpstream((messages, signal, options) => {
        const compact = messages.some(
          (m) =>
            m.role === "user" &&
            typeof m.content !== "string" &&
            m.content.some((b) => b.type === "text" && b.text.startsWith("Compaction:")),
        );
        requests.push({ compact, messages, ...options });
        let text = "successful answer";
        if (compact)
          text =
            requests.filter((r) => r.compact).length === 1
              ? "x".repeat(600)
              : "user: keep this decision";
        return radiusResponse(text, Promise.resolve(), false, signal);
      });
      const config = radiusDirectory();
      config.aiConfiguration = async () => ({
        ...(await radiusDirectory().aiConfiguration()),
        memory:
          mode === "shared" ? imageChoice : { provider: "radius", modelId: "claude-haiku-5-5" },
      });
      const runtime = await openSpace(new SpaceScope(platform, config), () => {});
      try {
        await runtime.account.configure({
          uid: "synthetic-user",
          input: { name: "Synthetic", focus: [], style: "brief", timezone: "UTC" },
        });
        const events = await collect(
          await runtime.conversation.chat({
            uid: "synthetic-user",
            input: {
              ...input,
              model: imageChoice,
              prompt: { kind: "message", text: "important decision ".repeat(90) },
            },
          }),
        );
        expect(events.some((e) => e.type === "done")).toBe(true);
        const compact = requests.find((r) => r.compact)!,
          turn = requests.find((r) => !r.compact)!;
        expect(compact).toBeDefined();
        expect(getCurrentTools(turn.messages).some((t) => t.name === "tavily_search")).toBe(true);
        expect(compact.sessionId).toBeTruthy();
        expect(turn.sessionId).toBeTruthy();
        const turnSystem = getCurrentSystemPrompt(turn.messages),
          compactSystem = getCurrentSystemPrompt(compact.messages);
        if (mode === "shared") {
          expect(compactSystem).toBe(turnSystem);
          expect(getCurrentTools(compact.messages)).toEqual(getCurrentTools(turn.messages));
          expect(compact.sessionId).toBe(turn.sessionId);
          expect(compact.toolChoice).toBe(turn.toolChoice);
          expect(compact.reasoning).toBe(turn.reasoning);
        } else {
          expect(turnSystem).not.toContain("# Compactions");
          expect(turnSystem).not.toContain("512 bytes");
          expect(compactSystem).not.toContain("# Turns");
          expect(compactSystem).not.toContain("tavily_search");
          expect(compactSystem).not.toContain("Synthetic");
          expect(getCurrentTools(compact.messages)).toEqual([]);
          expect(compact.sessionId).not.toBe(turn.sessionId);
          expect(compact.toolChoice).toBe("none");
        }
        const retries = requests.filter((r) => r.compact);
        expect(retries.length).toBeGreaterThanOrEqual(2);
        expect(getCurrentSystemPrompt(retries[1].messages)).toBe(
          getCurrentSystemPrompt(compact.messages),
        );
        expect(getCurrentTools(retries[1].messages)).toEqual(getCurrentTools(compact.messages));
        expect(retries[1].sessionId).toBe(compact.sessionId);
        expect(retries[1].toolChoice).toBe(compact.toolChoice);
        expect(retries[1].reasoning).toBe(compact.reasoning);
        const first = compact.messages.find((m) => m.role === "user")!;
        const second = retries[1].messages.find((m) => m.role === "user")!;
        expect(Array.isArray(first.content)).toBe(true);
        expect(second.content.slice(0, first.content.length)).toEqual(first.content);
      } finally {
        await runtime.close();
        platform.db.close();
      }
    },
    15000,
  );

  it("restores cache lanes after mode switches and isolates changes to the other model across reopen", async () => {
    const platform = createTestScopePlatform();
    const other = { provider: "radius" as const, modelId: "claude-haiku-5-5" };
    const third = { provider: "radius" as const, modelId: "claude-sonnet-5" };
    const configurations = [
      { chat: imageChoice, memory: other },
      { chat: imageChoice, memory: imageChoice },
      { chat: imageChoice, memory: other },
      { chat: third, memory: other },
      { chat: imageChoice, memory: third },
    ];
    let phase = 0;
    const seen: {
      phase: number;
      compact: boolean;
      system: string;
      tools: unknown;
      sessionId?: string;
    }[] = [];
    radiusUpstream((messages, signal, options) => {
      const compact = messages.some(
        (m) =>
          m.role === "user" &&
          typeof m.content !== "string" &&
          m.content.some((b) => b.type === "text" && b.text.startsWith("Compaction:")),
      );
      seen.push({
        phase,
        compact,
        system: getCurrentSystemPrompt(messages),
        tools: getCurrentTools(messages),
        sessionId: options?.sessionId,
      });
      return radiusResponse(
        compact ? "user: retain the agreed decision" : "successful answer",
        Promise.resolve(),
        false,
        signal,
      );
    });
    const directory = radiusDirectory();
    directory.aiConfiguration = async () => ({
      ...(await radiusDirectory().aiConfiguration()),
      ...configurations[phase],
    });
    let runtime = await openSpace(new SpaceScope(platform, directory), () => {});
    try {
      await runtime.account.configure({
        uid: "synthetic-user",
        input: { name: "Synthetic", focus: [], style: "brief", timezone: "UTC" },
      });
      for (phase = 0; phase < configurations.length; phase++) {
        if (phase > 0) runtime = await openSpace(new SpaceScope(platform, directory), () => {});
        const events = await collect(
          await runtime.conversation.chat({
            uid: "synthetic-user",
            input: {
              ...input,
              requestId: crypto.randomUUID(),
              model: configurations[phase].chat,
              prompt: { kind: "message", text: "important decision ".repeat(90) },
            },
          }),
        );
        expect(
          events.find((event) => event.type === "done"),
          JSON.stringify({ phase, events }),
        ).toBeDefined();
        await runtime.close();
      }
      const plan = (at: number, compact: boolean) => {
        const found = seen.find((request) => request.phase === at && request.compact === compact);
        expect(found).toBeDefined();
        const { system, tools, sessionId } = found!;
        expect(sessionId).toBeTruthy();
        return { system, tools, sessionId };
      };
      expect(plan(1, true)).toEqual(plan(1, false));
      expect(plan(0, true).sessionId).not.toBe(plan(0, false).sessionId);
      expect(plan(2, false)).toEqual(plan(0, false));
      expect(plan(2, true)).toEqual(plan(0, true));
      expect(plan(3, true)).toEqual(plan(0, true));
      expect(plan(4, false)).toEqual(plan(0, false));
    } finally {
      await runtime.close();
      platform.db.close();
    }
  }, 15000);

  it("excludes a failed provider prefix from history and memory across retry and reopen", async () => {
    let calls = 0;
    const attempts: { messages: Message[]; sessionId?: string }[] = [];
    radiusUpstream((messages, _signal, options) => {
      calls++;
      attempts.push({ messages, sessionId: options?.sessionId });
      expect(JSON.stringify(messages)).not.toContain("failed prefix");
      return radiusResponse(
        calls === 1 ? "failed prefix" : "successful answer",
        calls === 1
          ? runtime.account
              .configure({
                uid: "synthetic-user",
                input: {
                  name: "ChangedMidTurn",
                  focus: [],
                  style: "detailed",
                  timezone: "Asia/Shanghai",
                },
              })
              .then(() => {})
          : Promise.resolve(),
        calls === 1,
      );
    });
    const platform = createTestScopePlatform();
    let runtime = await openSpace(new SpaceScope(platform, radiusDirectory()), () => {});
    const request = { ...input, model: imageChoice };
    try {
      await runtime.account.configure({
        uid: "synthetic-user",
        input: { name: "Synthetic", focus: [], style: "brief", timezone: "UTC" },
      });
      const events = await collect(
        await runtime.conversation.chat({ uid: "synthetic-user", input: request }),
      );
      expect(events.find((event) => event.type === "done")).toMatchObject({
        text: "successful answer",
      });
      expect(calls).toBe(2);
      expect(attempts[1]).toEqual(attempts[0]);
      expect(getCurrentSystemPrompt(attempts[1].messages)).toContain("Synthetic");
      expect(getCurrentSystemPrompt(attempts[1].messages)).not.toContain("ChangedMidTurn");
      await runtime.close();
      runtime = await openSpace(new SpaceScope(platform, radiusDirectory()), () => {});
      expect((await runtime.history.page({})).messages.map((row) => [row.kind, row.text])).toEqual([
        ["user", "hello"],
        ["mira", "successful answer"],
      ]);
      expect(JSON.stringify(await runtime.memory.lines(null))).not.toContain("failed prefix");
      const replay = await collect(
        await runtime.conversation.chat({ uid: "synthetic-user", input: request }),
      );
      expect(replay.find((event) => event.type === "done")).toMatchObject({
        text: "successful answer",
      });
      expect(calls).toBe(2);
      const next = await collect(
        await runtime.conversation.chat({
          uid: "synthetic-user",
          input: { ...request, requestId: crypto.randomUUID() },
        }),
      );
      expect(next.some((event) => event.type === "done")).toBe(true);
      expect(getCurrentSystemPrompt(attempts[2].messages)).toContain("ChangedMidTurn");
      expect(attempts[2].sessionId).toBe(attempts[0].sessionId);
    } finally {
      await runtime.close();
      platform.db.close();
    }
  }, 15000);

  it("rolls back input, source and admission when SQLite rejects image attachment, then retries with pixels", async () => {
    const requests: Message[][] = [];
    radiusUpstream((messages) => {
      requests.push(messages);
      return radiusResponse("image answer");
    });
    const platform = createTestScopePlatform();
    let runtime = await openSpace(new SpaceScope(platform, radiusDirectory()), () => {});
    try {
      await runtime.account.configure({
        uid: "synthetic-user",
        input: { name: "Synthetic", focus: [], style: "brief", timezone: "UTC" },
      });
      const before = await runtime.history.tree({});
      const jpeg = new Uint8Array([
        255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 217,
      ]);
      const upload = await runtime.images.upload(jpeg.buffer);
      if (!upload.ok) throw new Error(upload.message);
      const request: ChatInput = {
        ...input,
        model: imageChoice,
        prompt: { kind: "message", text: "look", image: upload.image.id },
      };
      platform.db.exec(
        "CREATE TRIGGER reject_image BEFORE UPDATE OF user_id ON mira_images BEGIN SELECT RAISE(ABORT, 'image attach rejected'); END",
      );
      const failed = await collect(
        await runtime.conversation.chat({ uid: "synthetic-user", input: request }),
      );
      expect(failed.some((event) => event.type === "error")).toBe(true);
      expect(requests).toHaveLength(0);
      expect((await runtime.history.page({})).messages).toEqual([]);
      expect((await runtime.history.tree({}))?.total).toBe(before?.total);
      expect(
        platform.db
          .prepare("SELECT * FROM mira_memory_source WHERE source = ?")
          .all(`input:${input.requestId}`),
      ).toEqual([]);
      expect(
        platform.db
          .prepare("SELECT v FROM mira_kv WHERE k = ?")
          .all(`operation:${input.requestId}`),
      ).toEqual([]);
      expect(
        platform.db.prepare("SELECT user_id FROM mira_images WHERE id = ?").get(upload.image.id),
      ).toMatchObject({ user_id: null });
      platform.db.exec("DROP TRIGGER reject_image");
      // Retry in the same runtime also proves Memory's in-process cursor/view rolled back.
      const events = await collect(
        await runtime.conversation.chat({ uid: "synthetic-user", input: request }),
      );
      const done = events.find((event) => event.type === "done");
      expect(done, "Image retry must finish after in-memory admission rollback").toMatchObject({
        type: "done",
      });
      if (done?.type !== "done") throw new Error("Image retry did not finish");
      expect(requests).toHaveLength(1);
      expect(
        requests[0]
          .filter((message) => message.role === "user")
          .flatMap((message) => (Array.isArray(message.content) ? message.content : [])),
      ).toContainEqual({
        type: "image",
        mimeType: "image/jpeg",
        data: Buffer.from(jpeg).toString("base64"),
      });
      expect(
        platform.db.prepare("SELECT user_id FROM mira_images WHERE id = ?").get(upload.image.id),
      ).toMatchObject({ user_id: done.userId });
      const recalled = await runtime.memory.zoom({ id: done.userId });
      expect(recalled.image).toEqual({
        type: "image",
        mimeType: "image/jpeg",
        data: Buffer.from(jpeg).toString("base64"),
      });
      expect((await runtime.memory.zoom({ id: done.userId, at: 1 })).image).toBeUndefined();
      const exported = (await new Response(await runtime.memory.export(null)).json()) as {
        messages: { id: number; images?: string[] }[];
        summaries: unknown[];
        images: Record<string, { data: string; userId: number }>;
      };
      expect(exported.messages.find((message) => message.id === done.userId)?.images).toEqual([
        upload.image.id,
      ]);
      expect(exported.images[upload.image.id].data).toBe(Buffer.from(jpeg).toString("base64"));
      expect(exported.summaries.length).toBeGreaterThan(0);
      await runtime.close();
      runtime = await openSpace(new SpaceScope(platform, radiusDirectory()), () => {});
      expect(
        (await runtime.history.page({})).messages.filter((row) => row.kind === "user"),
      ).toHaveLength(1);
      const replay = await collect(
        await runtime.conversation.chat({ uid: "synthetic-user", input: request }),
      );
      expect(replay.some((event) => event.type === "done")).toBe(true);
      expect(requests).toHaveLength(1);
    } finally {
      await runtime.close();
      platform.db.close();
    }
  }, 15000);

  it("recovers the actual persisted generation after a fatal SQLite commit failure without retaining its prefix", async () => {
    const partial = Promise.withResolvers<void>(),
      finish = Promise.withResolvers<void>();
    const failed = Promise.withResolvers<Promise<void>>();
    let calls = 0;
    radiusUpstream((_messages, signal) => {
      calls++;
      return radiusResponse(
        calls === 1 ? "interrupted prefix" : "recovered answer",
        calls === 1 ? finish.promise : Promise.resolve(),
        false,
        signal,
      );
    });
    const platform = createTestScopePlatform();
    let runtime = await openSpace(new SpaceScope(platform, radiusDirectory()), (closing) =>
      failed.resolve(closing),
    );
    const request = { ...input, model: imageChoice };
    try {
      await runtime.account.configure({
        uid: "synthetic-user",
        input: { name: "Synthetic", focus: [], style: "brief", timezone: "UTC" },
      });
      const first = collect(
        await runtime.conversation.chat({ uid: "synthetic-user", input: request }),
        (event) => {
          if (event.type === "delta" && event.text === "interrupted prefix") partial.resolve();
        },
      ).catch(() => []);
      await partial.promise;
      platform.db.exec(
        "CREATE TRIGGER fail_native_commit BEFORE UPDATE ON pi_durable_metadata BEGIN SELECT RAISE(ABORT, 'synthetic storage crash'); END",
      );
      finish.resolve();
      await failed.promise;
      await first;
      platform.db.exec("DROP TRIGGER fail_native_commit");
      runtime = await openSpace(new SpaceScope(platform, radiusDirectory()), () => {});
      const recovered = await collect(
        await runtime.conversation.chat({ uid: "synthetic-user", input: request }),
      );
      expect(recovered.find((event) => event.type === "done")).toMatchObject({
        text: "recovered answer",
      });
      expect(calls).toBe(2);
      expect((await runtime.history.page({})).messages.map((row) => [row.kind, row.text])).toEqual([
        ["user", "hello"],
        ["mira", "recovered answer"],
      ]);
      expect(JSON.stringify(await runtime.memory.lines(null))).not.toContain("interrupted prefix");
    } finally {
      finish.resolve();
      await runtime.close();
      platform.db.close();
    }
  }, 15000);

  it("backpressures a slow observer, detaches it on cancel, and durably completes for reconnect and replay", async () => {
    const finish = Promise.withResolvers<void>(),
      entered = Promise.withResolvers<void>();
    const calls = { value: 0 };
    let append!: (text: string) => void;
    upstream(
      () => entered.resolve(),
      finish.promise,
      calls,
      (write) => {
        append = write;
      },
    );
    const openings = vi.spyOn(Harness, "open");
    const writes = vi.spyOn(WritableStreamDefaultWriter.prototype, "write");
    const stopped = Promise.withResolvers<void>();
    const platform = createTestScopePlatform();
    let runtime = await openSpace(new SpaceScope(platform, directory()), () => {});
    try {
      await runtime.account.configure({
        uid: "synthetic-user",
        input: { name: "Synthetic", focus: [], style: "brief", timezone: "UTC" },
      });
      const opened = openings.mock.results[0];
      if (opened.type !== "return") throw new Error("Harness did not open");
      const watches = vi.spyOn(await opened.value, "watchDoc");
      const stream = await runtime.conversation.chat({ uid: "synthetic-user", input });
      const reader = stream.getReader();
      await entered.promise;
      // Leave this reader blocked while another client witnesses the committed partial.
      const witnessed = Promise.withResolvers<void>();
      let observed = "",
        target = "";
      let revision = Promise.withResolvers<void>();
      const slowWriter = writes.mock.contexts[0];
      const observer = collect(
        await runtime.conversation.chat({ uid: "synthetic-user", input }),
        (event) => {
          if (event.type === "delta") observed += event.text;
          if (event.type === "replace") observed = event.text;
          if (observed.includes("synthetic answer")) witnessed.resolve();
          if (target && observed.endsWith(target)) revision.resolve();
        },
      );
      await witnessed.promise;
      for (let i = 0; i < 5; i++) {
        target = ` frame-${i}`;
        revision = Promise.withResolvers<void>();
        append(target);
        await revision.promise;
      }
      // Two admission notices plus one blocked live frame; later frames stay in Pi's bounded watch.
      expect(
        writes.mock.contexts.filter((writer) => writer === slowWriter).length,
      ).toBeLessThanOrEqual(3);
      for (const result of watches.mock.results) {
        if (result.type !== "return") continue;
        const watch = await result.value;
        if (!watch) continue;
        const originalStop = watch.stop.bind(watch);
        vi.spyOn(watch, "stop").mockImplementation(() => {
          stopped.resolve();
          return originalStop();
        });
      }
      const decoder = new TextDecoder();
      let text = "";
      while (!text.includes('"type":"delta"')) {
        const result = await reader.read();
        if (result.done) throw new Error("Slow observer closed before its snapshot");
        text += decoder.decode(result.value);
      }
      expect(text).toContain("synthetic answer");
      await reader.cancel();
      await expectWitness(
        stopped.promise,
        "Cancelled reader must detach while the provider is paused",
      );
      // A client that never reads must not hold durable completion or runtime shutdown.
      await runtime.conversation.chat({ uid: "synthetic-user", input });
      const answer = `${observed} continued`;
      append(" continued");
      finish.resolve();
      const events = await observer;
      expect(events.find((event) => event.type === "done")).toMatchObject({ text: answer });
      expect(calls.value).toBe(1);
      await runtime.close();
      runtime = await openSpace(new SpaceScope(platform, directory()), () => {});
      const replay = await collect(
        await runtime.conversation.chat({ uid: "synthetic-user", input }),
      );
      expect(replay.find((event) => event.type === "done")).toMatchObject({ text: answer });
      expect((await runtime.history.page({})).messages).toHaveLength(2);
      expect(calls.value).toBe(1);
    } finally {
      finish.resolve();
      await runtime.close();
      platform.db.close();
    }
  }, 15000);

  it("coalesces reconnects, persists one reply and serves it after reopen without another model request", async () => {
    const entered = Promise.withResolvers<void>(),
      finish = Promise.withResolvers<void>(),
      calls = { value: 0 };
    upstream(() => entered.resolve(), finish.promise, calls);
    const platform = createTestScopePlatform();
    let runtime = await openSpace(new SpaceScope(platform, directory()), () => {});
    try {
      await runtime.account.configure({
        uid: "synthetic-user",
        input: { name: "Synthetic", focus: [], style: "brief", timezone: "UTC" },
      });
      const firstPartial = Promise.withResolvers<void>();
      const first = collect(
        await runtime.conversation.chat({ uid: "synthetic-user", input }),
        (event) => {
          if (event.type === "delta" && event.text === "synthetic answer") firstPartial.resolve();
        },
      );
      await entered.promise;
      await firstPartial.promise;
      expect(await runtime.conversation.prepareImport(null)).toBe(false);
      const secondPartial = Promise.withResolvers<void>();
      const second = collect(
        await runtime.conversation.chat({ uid: "synthetic-user", input }),
        (event) => {
          if (event.type === "delta" && event.text === "synthetic answer") secondPartial.resolve();
        },
      );
      // The provider emits no further frame until BOTH observers have the partial.
      await expectWitness(
        secondPartial.promise,
        "Reconnect must hydrate the partial while the provider is paused",
      );
      finish.resolve();
      const [a, b] = await Promise.all([first, second]);
      expect(a.find((event) => event.type === "done")).toMatchObject({ text: "synthetic answer" });
      expect(b.find((event) => event.type === "done")).toMatchObject({ text: "synthetic answer" });
      expect(calls.value).toBe(1);
      const history = await runtime.history.page({});
      expect(history.messages.map((row) => [row.kind, row.text])).toEqual([
        ["user", "hello"],
        ["mira", "synthetic answer"],
      ]);
      await runtime.close();
      runtime = await openSpace(new SpaceScope(platform, directory()), () => {});
      const replay = await collect(
        await runtime.conversation.chat({ uid: "synthetic-user", input }),
      );
      expect(replay.find((event) => event.type === "done")).toMatchObject({
        text: "synthetic answer",
      });
      expect(calls.value).toBe(1);
      expect((await runtime.history.page({})).messages).toHaveLength(2);
      const changed = await collect(
        await runtime.conversation.chat({
          uid: "synthetic-user",
          input: { ...input, prompt: { kind: "message", text: "different prompt" } },
        }),
      );
      expect(changed.some((event) => event.type === "error")).toBe(true);
      expect(calls.value).toBe(1);
    } finally {
      finish.resolve();
      await runtime.close();
      platform.db.close();
    }
  }, 15000);
  it("cancels a running request and retains its witnessed partial reply without accepting the same request again", async () => {
    const finish = Promise.withResolvers<void>(),
      partial = Promise.withResolvers<void>(),
      calls = { value: 0 };
    upstream(() => {}, finish.promise, calls);
    const platform = createTestScopePlatform();
    const runtime = await openSpace(new SpaceScope(platform, directory()), () => {});
    try {
      await runtime.account.configure({
        uid: "synthetic-user",
        input: { name: "Synthetic", focus: [], style: "brief", timezone: "UTC" },
      });
      const output = collect(
        await runtime.conversation.chat({ uid: "synthetic-user", input }),
        (event) => {
          if (event.type === "delta" && event.text.includes("synthetic answer")) partial.resolve();
        },
      );
      await partial.promise;
      await runtime.conversation.stop(input.requestId);
      const events = await output;
      expect(events.some((event) => event.type === "stopped")).toBe(true);
      expect((await runtime.history.page({})).messages).toMatchObject([
        { kind: "user", text: "hello" },
        { kind: "mira", text: "synthetic answer", stopped: true },
      ]);
      const replay = await collect(
        await runtime.conversation.chat({ uid: "synthetic-user", input }),
      );
      expect(replay.find((event) => event.type === "done")).toMatchObject({
        stopped: true,
        text: "synthetic answer",
      });
      expect(calls.value).toBe(1);
    } finally {
      finish.resolve();
      await runtime.close();
      platform.db.close();
    }
  }, 15000);
  it.each(["question", "reply"] as const)(
    "regenerates by %s and supersedes later requests durably",
    async (kind) => {
      const calls = { value: 0 };
      upstream(() => {}, Promise.resolve(), calls);
      const platform = createTestScopePlatform();
      let runtime = await openSpace(new SpaceScope(platform, directory()), () => {});
      try {
        await runtime.account.configure({
          uid: "synthetic-user",
          input: { name: "Synthetic", focus: [], style: "brief", timezone: "UTC" },
        });
        const first = (
          await collect(await runtime.conversation.chat({ uid: "synthetic-user", input }))
        ).find((event) => event.type === "done");
        if (first?.type !== "done") throw new Error("Original request did not complete");
        const laterInput: ChatInput = {
          ...input,
          requestId: "synthetic-request-later",
          prompt: { kind: "message", text: "later question" },
        };
        await collect(
          await runtime.conversation.chat({ uid: "synthetic-user", input: laterInput }),
        );
        const replacement: ChatInput = {
          ...input,
          requestId: `regenerate-${kind}`,
          prompt:
            kind === "question" ? { kind, userId: first.userId } : { kind, replyId: first.replyId },
        };
        const regenerated = await collect(
          await runtime.conversation.chat({ uid: "synthetic-user", input: replacement }),
        );
        expect(regenerated.find((event) => event.type === "done")).toMatchObject({
          userId: first.userId,
          text: "synthetic answer",
        });
        expect((await runtime.history.page({})).messages).toMatchObject([
          { kind: "user", text: "hello" },
          { kind: "mira", text: "synthetic answer", replyTo: first.userId },
        ]);
        expect((await runtime.history.page({})).messages).toHaveLength(2);
        expect(calls.value).toBe(3);
        await runtime.close();
        runtime = await openSpace(new SpaceScope(platform, directory()), () => {});
        const replay = await collect(
          await runtime.conversation.chat({ uid: "synthetic-user", input: replacement }),
        );
        expect(replay.find((event) => event.type === "done")).toMatchObject({
          userId: first.userId,
        });
        const superseded = await collect(
          await runtime.conversation.chat({ uid: "synthetic-user", input: laterInput }),
        );
        expect(superseded.find((event) => event.type === "error")).toMatchObject({
          message: "这条回复已被替换，请刷新页面查看当前对话。",
        });
        expect(calls.value).toBe(3);
      } finally {
        await runtime.close();
        platform.db.close();
      }
    },
    15000,
  );
});
