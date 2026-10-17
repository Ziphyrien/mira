import { describe, expect, it, vi } from "vite-plus/test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createCompactor } from "./compactor";
import { Memory } from "./store";
import { textBlocks } from "../../core/content";
import { UsageLedger } from "../admin/api";
import type { CompactionModels } from "../models/api";
import { SpaceScope, type DirectoryPort } from "../../core/storage";
import { createTestScopePlatform } from "../../testing/node-sqlite";

const directory: DirectoryPort = {
  aiConfiguration: async () => ({ keys: {}, chat: null, memory: null }),
  chatModel: async () => null,
  touch: async () => {},
  remove: async () => {},
};
const reply: AssistantMessage = {
  role: "assistant",
  api: "pi-messages",
  provider: "radius",
  model: "gpt-6-sol",
  content: [{ type: "text", text: "must not publish" }],
  stopReason: "error",
  errorMessage: "billable failure",
  timestamp: 1700000000000,
  usage: {
    input: 10,
    output: 20,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 30,
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
  },
};
const original = "long input ".repeat(100);
const summary = "user: keep the original decision and its reason";
const answer = (text: string): AssistantMessage => ({
  ...reply,
  content: [{ type: "text", text }],
  stopReason: "stop",
  errorMessage: undefined,
});

function fixture(complete: ReturnType<CompactionModels["select"]>["complete"]) {
  const platform = createTestScopePlatform();
  const scope = new SpaceScope(platform, directory);
  const ledger = new UsageLedger(scope.storage.sql);
  const charge = vi.fn((cost: number) => ledger.charge(cost));
  const request = vi.fn(complete);
  const compact = createCompactor(
    scope,
    async () => ({
      version: 1,
      mode: "separate",
      model: { provider: "radius", modelId: "gpt-6-sol" },
      system: "Compress the input into one line.",
      tools: [],
      sessionId: "synthetic-compaction",
    }),
    { select: () => ({ complete: request }) },
    charge,
  );
  const work: Promise<void>[] = [];
  const memory = new Memory(scope.storage, compact, (pending) => {
    work.push(pending);
  });
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  return {
    platform,
    scope,
    ledger,
    charge,
    request,
    memory,
    work,
    errors,
    async close() {
      memory.close();
      await Promise.all(work);
      errors.mockRestore();
      platform.db.close();
    },
  };
}

describe("compactor usage at the model boundary", () => {
  it("preserves literal closing tags inside summary text when forming four-line request blocks", async () => {
    const f = fixture(async () => answer(summary));
    try {
      f.memory.record(
        "context",
        Array.from({ length: 5 }, (_, i) => ({
          kind: "user" as const,
          text: i === 4 ? "literal </chat>" : String(i),
        })),
      );
      f.memory.record("task", [{ kind: "user", text: original }]);
      await Promise.all(f.work);
      const content = f.request.mock.calls[0][0].messages[0].content;
      expect(Array.isArray(content) && content.slice(0, 3)).toEqual([
        { type: "text", text: "<chat>\n" },
        { type: "text", text: "0+1|user: 0\n1+1|user: 1\n2+1|user: 2\n3+1|user: 3\n" },
        { type: "text", text: "4+1|user: literal </chat>\n</chat>\n" },
      ]);
    } finally {
      await f.close();
    }
  });
  it.each(["error", "provider-abort", "cancel", "retire"] as const)(
    "accounts received usage for %s without publishing or retrying",
    async (mode) => {
      const entered = Promise.withResolvers<AbortSignal>(),
        result = Promise.withResolvers<AssistantMessage>();
      const f = fixture(async (_context, signal) => {
        entered.resolve(signal);
        return result.promise;
      });
      try {
        f.memory.record("billable", [{ kind: "user", text: original }]);
        const signal = await entered.promise;
        const cancelled = mode === "cancel" || mode === "retire";
        if (cancelled) f.memory.close();
        if (mode === "retire") f.scope.retire();
        expect(signal.aborted).toBe(cancelled);
        result.resolve({
          ...reply,
          stopReason: mode === "error" ? "error" : "aborted",
          errorMessage: mode === "provider-abort" ? "Request aborted" : reply.errorMessage,
        });
        await Promise.all(f.work);
        expect(f.request).toHaveBeenCalledTimes(1);
        if (!cancelled) {
          expect(f.errors).toHaveBeenCalledWith(
            expect.stringContaining(`stopReason=${mode === "error" ? "error" : "aborted"}`),
          );
          expect(f.errors).toHaveBeenCalledWith(expect.stringContaining("signalCause=none"));
          expect(f.errors.mock.calls.flat().join(" ")).not.toContain("must not publish");
          expect(f.errors.mock.calls.flat().join(" ")).not.toContain(original);
        }
        expect(f.charge).toHaveBeenCalledTimes(mode === "retire" ? 0 : 1);
        expect(new UsageLedger(f.platform.storage.sql).cost()).toBe(mode === "retire" ? 0 : 3);
        expect(f.platform.db.prepare("SELECT * FROM mira_memory_node").all()).toEqual([]);
        expect(
          f.platform.db.prepare("SELECT summaries FROM mira_memory_count").get(),
        ).toMatchObject({
          summaries: 0,
        });
      } finally {
        result.resolve(reply);
        await f.close();
      }
    },
  );

  it.each([
    { name: "empty", content: [], feedback: /empty/i },
    { name: "whitespace", content: [{ type: "text", text: " \r\n " }], feedback: /empty/i },
    {
      name: "numbered",
      content: [{ type: "text", text: "0+1|user: decision" }],
      feedback: /id\+n\||unnumbered/i,
    },
    {
      name: "multiline",
      content: [{ type: "text", text: "user: decision\r\nmira: reason" }],
      feedback: /one.*line|single.*line/i,
    },
  ] satisfies { name: string; content: AssistantMessage["content"]; feedback: RegExp }[])(
    "corrects $name output with feedback and publishes the summary with all usage",
    async ({ content, feedback }) => {
      const responses = [{ ...answer(""), content }, answer(summary)];
      const feedbacks: unknown[] = [];
      const f = fixture(async (context) => {
        feedbacks.push(textBlocks(context.messages.at(-1)!.content));
        return responses.shift()!;
      });
      try {
        f.memory.record("recover", [{ kind: "user", text: original }]);
        await Promise.all(f.work);
        expect(f.memory.lines()).toEqual([{ start: 0, count: 1, text: summary }]);
        expect(f.request).toHaveBeenCalledTimes(2);
        expect(feedbacks[1]).toEqual(expect.stringMatching(feedback));
        expect(f.ledger.cost()).toBe(6);
        expect(f.memory.history(undefined, 10)).toEqual([
          expect.objectContaining({ i: 0, kind: "user", text: original }),
        ]);
        expect(f.errors).not.toHaveBeenCalled();
      } finally {
        await f.close();
      }
    },
  );

  it("keeps the shortest valid-format candidate whole when five replies cannot fit 512 bytes", async () => {
    // 540 UTF-8 bytes: shorter in bytes than the other valid candidates, but still over the limit.
    const shortest = "长".repeat(180);
    const responses = ["a".repeat(600), shortest, "0+1|short", "", "b".repeat(560)];
    const f = fixture(async () => answer(responses.shift()!));
    try {
      f.memory.record("fallback", [{ kind: "user", text: original }]);
      await Promise.all(f.work);
      expect(f.request).toHaveBeenCalledTimes(5);
      expect(f.memory.lines()).toEqual([{ start: 0, count: 1, text: shortest }]);
      expect(f.ledger.cost()).toBe(15);
      expect(f.errors).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });

  it("leaves exhausted invalid output failed with raw text intact until later preparation retries it", async () => {
    const responses = ["", "first\nsecond", "0+1|numbered", " ", "first\rsecond", summary];
    const f = fixture(async () => answer(responses.shift()!));
    try {
      f.memory.record("exhausted", [{ kind: "user", text: original }]);
      await Promise.all(f.work);
      expect(f.request).toHaveBeenCalledTimes(5);
      expect(f.memory.lines()).toEqual([]);
      expect(f.ledger.cost()).toBe(15);
      expect(f.platform.db.prepare("SELECT l, i, state FROM mira_memory_job").all()).toEqual([
        { l: 0, i: 0, state: "failed" },
      ]);
      expect(f.memory.tree(0, 1)?.original?.text).toBe(original);
      expect(f.errors).toHaveBeenCalledWith(expect.stringContaining("attempt=5/5"));
      expect(f.errors).toHaveBeenCalledWith(
        expect.stringContaining("stopReason=stop, signalCause=none"),
      );
      f.memory.pump();
      expect(f.memory.working()).toBe(false);
      expect(f.request).toHaveBeenCalledTimes(5);
      expect(await f.memory.prepare(1000)).toBe(true);
      await Promise.all(f.work);
      expect(f.request).toHaveBeenCalledTimes(6);
      expect(f.ledger.cost()).toBe(18);
      expect(f.memory.lines()).toEqual([{ start: 0, count: 1, text: summary }]);
      expect(f.memory.tree(0, 1)?.original?.text).toBe(original);
      expect(f.platform.db.prepare("SELECT * FROM mira_memory_job").all()).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it.each(["cancel", "retire"] as const)(
    "does not start a request after %s during setup",
    async (mode) => {
      const f = fixture(async () => answer(summary));
      try {
        f.memory.record("cancel-before-request", [{ kind: "user", text: original }]);
        f.memory.close();
        if (mode === "retire") f.scope.retire();
        await Promise.all(f.work);
        expect(f.request).not.toHaveBeenCalled();
        expect(f.charge).not.toHaveBeenCalled();
      } finally {
        await f.close();
      }
    },
  );
});
