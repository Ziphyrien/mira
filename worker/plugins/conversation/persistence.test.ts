import { describe, expect, it } from "vite-plus/test";
import { SpaceScope } from "../../core/storage";
import { createTestScopePlatform } from "../../testing/node-sqlite";
import { Images } from "../images/store";
import { ConversationPersistence } from "./persistence";
import { Memory } from "../memory/store";
import { HistoryProjection } from "../history/api";
import type { Operation } from "./ports";
function operation(requestId: string, attemptId: string): Operation {
  return {
    input: {
      requestId,
      prompt: { kind: "message", text: "hello" },
      thinking: "off",
      model: { provider: "deepseek", modelId: "deepseek-flash" },
    },
    attemptId,
    userId: 0,
    text: "hello",
    view: "<chat></chat>",
    status: "running",
  };
}
describe("persisted search ownership", () => {
  it("does not attach a retired search completion to a replacement request", () => {
    const platform = createTestScopePlatform();
    const scope = new SpaceScope(platform, {
      aiConfiguration: async () => ({ keys: {}, chat: null, memory: null }),
      chatModel: async () => null,
      touch: async () => {},
      remove: async () => {},
    });
    try {
      const journal = new ConversationPersistence(
        scope.storage,
        new Images(scope.storage.sql),
        () => scope.alive,
      );
      journal.begin(operation("request-a", "attempt-a"));
      journal.report({ id: "search-a", query: "facts", status: "running", sources: [] });
      expect(journal.searches("attempt-a")).toHaveLength(1);
      journal.complete({ ...operation("request-a", "attempt-a"), status: "done" });
      journal.begin(operation("request-b", "attempt-b"));
      journal.report({ id: "search-a", query: "facts", status: "done", sources: [] });
      expect(journal.searches("attempt-b")).toEqual([]);
      journal.report({ id: "search-b", query: "new facts", status: "running", sources: [] });
      journal.report({ id: "search-b", query: "new facts", status: "done", sources: [] });
      expect(journal.searches("attempt-b").map((item) => [item.id, item.status])).toEqual([
        ["search-b", "done"],
      ]);
      scope.retire();
      journal.report({ id: "search-c", query: "late", status: "running", sources: [] });
      expect(
        platform.storage.sql
          .exec<{ v: string }>("SELECT v FROM mira_kv WHERE k=?", "search-owner:search-c")
          .toArray(),
      ).toEqual([]);
    } finally {
      platform.db.close();
    }
  });
  it("rolls back memory, reply metadata, images and journal together, then publishes a complete rewind", async () => {
    const platform = createTestScopePlatform();
    const scope = new SpaceScope(platform, {
      aiConfiguration: async () => ({ keys: {}, chat: null, memory: null }),
      chatModel: async () => null,
      touch: async () => {},
      remove: async () => {},
    });
    const images = new Images(scope.storage.sql);
    const memory = new Memory(
      scope.storage,
      async () => "summary",
      () => {},
    );
    const persistence = new ConversationPersistence(scope.storage, images, () => scope.alive);
    const history = new HistoryProjection(memory, images, persistence);
    try {
      memory.record("input:request-a", [{ kind: "user", text: "question", date: 1000 }]);
      memory.record("entry:answer", [{ kind: "mira", text: "answer", date: 1001 }]);
      const image = images.put(
        new Uint8Array([255, 216, 255, 192, 0, 8, 8, 0, 1, 0, 1, 1, 255, 217]).buffer,
      );
      if (!image) throw new Error("JPEG fixture was rejected");
      images.attach(image.id, 0);
      const request = operation("request-a", "attempt-a");
      persistence.begin(request);
      const searches = [{ id: "search-a", query: "facts", status: "done" as const, sources: [] }];
      const reply = {
        text: "answer",
        thinking: "thoughts",
        searches,
        stopped: true as const,
        at: 1001,
        userId: 0,
        replyId: 1,
      };
      scope.storage.sql.exec(
        "CREATE TRIGGER reject_completion BEFORE INSERT ON mira_kv WHEN NEW.k = 'operation:request-a' BEGIN SELECT RAISE(ABORT, 'completion failure'); END",
      );
      expect(() => persistence.complete({ ...request, status: "done" }, reply)).toThrow(
        "completion failure",
      );
      expect(persistence.reply("request-a")).toBeUndefined();
      expect(persistence.metadata([1]).get(1)).toEqual({});
      expect(persistence.active()?.status).toBe("running");
      scope.storage.sql.exec("DROP TRIGGER reject_completion");
      persistence.complete({ ...request, status: "done" }, reply);
      const before = history.rows(undefined, 80),
        epoch = persistence.epoch();
      await expect(
        memory.rewind(0, "failed-branch", () => {
          persistence.truncate(0, "replacement");
          throw new Error("Injected transaction failure");
        }),
      ).rejects.toThrow("Injected transaction failure");
      expect(memory.tree()?.total).toBe(2);
      expect(history.rows(undefined, 80)).toEqual(before);
      expect(images.get(image.id)).toBeDefined();
      expect(persistence.reply("request-a")).toMatchObject({
        thinking: "thoughts",
        searches,
        stopped: true,
        replyId: 1,
      });
      expect(persistence.read("request-a")?.status).toBe("done");
      expect(persistence.epoch()).toBe(epoch);
      await memory.rewind(0, "replacement", () => persistence.truncate(0, "replacement"));
      expect(history.rows(undefined, 80)).toEqual([]);
      expect(images.get(image.id)).toBeUndefined();
      expect(persistence.metadata([1]).get(1)).toEqual({});
      expect(persistence.reply("request-a")).toBeUndefined();
      expect(persistence.read("request-a")?.status).toBe("superseded");
      expect(persistence.epoch()).not.toBe(epoch);
    } finally {
      memory.close();
      await scope.drain();
      platform.db.close();
    }
  });
});
