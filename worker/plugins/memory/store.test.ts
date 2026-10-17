import { describe, it, expect, vi } from "vite-plus/test";
import { Memory } from "./store";
import { createTestScopePlatform } from "../../testing/node-sqlite";

describe("Memory store behavior", () => {
  it("folds completed summaries before another message and preserves the frozen turn across reopen", async () => {
    const platform = createTestScopePlatform(), work: Promise<void>[] = [];
    let memory = new Memory(platform.storage, async () => "s".repeat(480), (task) => work.push(task));
    memory.freeze("frozen turn");
    memory.record("batch", Array.from({ length: 300 }, () => ({ kind: "user", text: "x".repeat(474) })));
    for (let at = 0; at < work.length;) { const stop = work.length; await Promise.all(work.slice(at, stop)); at = stop; }
    // Unii 1.0.138 produces 133 lines / 63,840 bytes for this same workload.
    expect(memory.lines()).toHaveLength(133);
    expect(memory.tree()?.nodes).toHaveLength(133);
    expect(memory.lines().reduce((n, line) => n + line.text.length, 0)).toBe(63_840);
    expect(memory.lines().reduce((n, line) => n + line.count, 0)).toBe(300);
    expect(memory.frozen()).toBe("frozen turn");
    const view = memory.render(); memory.close();
    memory = new Memory(platform.storage, async () => "unused", () => {});
    expect(memory.render()).toBe(view);
    expect(memory.frozen()).toBe("frozen turn");
    expect(memory.zoom(299, 1)).toBe(`299+0|user: ${"x".repeat(474)}`);
    memory.close(); platform.db.close();
  });
  it("starts 64 compactions and admits the next leaf when one completes", async () => {
    const platform = createTestScopePlatform(), work: Promise<void>[] = [];
    const pending: ReturnType<typeof Promise.withResolvers<string>>[] = [];
    const memory = new Memory(platform.storage, async () => {
      const task = Promise.withResolvers<string>(); pending.push(task); return task.promise;
    }, (task) => work.push(task));
    memory.record("batch", Array.from({ length: 65 }, () => ({ kind: "user", text: "x".repeat(600) })));
    expect(pending).toHaveLength(64);
    pending[0].resolve("summary"); await work[0];
    expect(pending).toHaveLength(65);
    memory.close(); pending.forEach((task) => task.resolve("summary"));
    await Promise.all(work); platform.db.close();
  });
  it("recovers a missing view and queue without losing source identity or image references", () => {
    const platform = createTestScopePlatform();
    let memory = new Memory(platform.storage, async () => "summary", () => {});
    memory.record("small", [{ kind: "user", text: "保留原话", image: "image-id" }]); memory.close();
    platform.storage.sql.exec("DELETE FROM mira_memory_state");
    platform.storage.sql.exec("DELETE FROM mira_memory_job");
    memory = new Memory(platform.storage, async () => "summary", () => {});
    expect(memory.render()).toContain("保留原话");
    expect(memory.image(0)).toBe("image-id");
    expect(memory.record("small", [{ kind: "user", text: "duplicate" }])).toBe(false);
    memory.close(); platform.db.close();
  });
  it("splits at newline boundaries and places a long message's image on its last record", async () => {
    const platform = createTestScopePlatform(), work: Promise<void>[] = [];
    const memory = new Memory(platform.storage, async () => "summary", (task) => work.push(task));
    const source = "a".repeat(29_000) + "\n" + "😀".repeat(1000);
    memory.record("long", [{ kind: "user", text: source, image: "image-id" }]);
    expect(memory.T).toBe(2); expect(memory.user(0)?.text).toBe(source);
    expect(memory.image(0)).toBeUndefined(); expect(memory.image(1)).toBe("image-id");
    expect(memory.zoom(1, 1)).toContain("[image image-id]");
    expect(memory.zoom(1, 1, 2)).not.toContain("[image image-id]");
    memory.close(); await Promise.all(work); platform.db.close();
  });
  it("appends messages and guarantees source idempotency", async () => {
    const platform = createTestScopePlatform();
    const memory = new Memory(
      platform.storage,
      async () => "summary",
      () => {},
    );

    const messages = [
      { kind: "user" as const, text: "Hello Mira", date: 1000 },
      { kind: "mira" as const, text: "Hello User", date: 1001 },
    ];

    // First append under source 'turn-1' returns true
    const firstResult = memory.record("turn-1", messages);
    expect(firstResult).toBe(true);
    expect(memory.T).toBe(2);

    // Second append under the same source must be idempotent and return false
    const secondResult = memory.record("turn-1", messages);
    expect(secondResult).toBe(false);
    expect(memory.T).toBe(2); // No duplicate rows created!

    // Logs in SQLite reflect only 2 messages
    const rows = platform.storage.sql
      .exec<{ i: number; text: string }>("SELECT i, text FROM mira_memory_log")
      .toArray();
    expect(rows).toHaveLength(2);
    expect(rows[0].text).toBe("Hello Mira");
    expect(rows[1].text).toBe("Hello User");
  });

  it("provides tree, zoom, and date projections", async () => {
    const platform = createTestScopePlatform();
    const memory = new Memory(
      platform.storage,
      async () => "summary",
      () => {},
    );

    memory.record("msg-1", [{ kind: "user", text: "First message", date: 1700000000000 }]);

    const tree = memory.tree();
    expect(tree).toBeDefined();
    expect(tree?.total).toBe(1);
    expect(tree?.nodes).toHaveLength(1);
    expect(tree?.nodes[0].id).toBe(0);

    const zoom = memory.zoom(0, 1);
    expect(zoom).toContain("First message");

    const dateStr = memory.date(0, "UTC");
    expect(typeof dateStr).toBe("string");
    expect(dateStr.length).toBeGreaterThan(0);
  });

  it("bypasses compactor for small messages (<=512 bytes) and uses compactor for big text", async () => {
    const platform = createTestScopePlatform();
    const compactorMock = vi.fn(async () => "compacted-result");
    const memory = new Memory(platform.storage, compactorMock, () => {});

    // Small message (<= 512 bytes)
    memory.record("small", [{ kind: "user", text: "Small message under 512 bytes" }]);
    // Small message does not trigger compactor job
    expect(compactorMock).not.toHaveBeenCalled();

    // Large synthetic message (> 512 bytes)
    const largeText = "A".repeat(600);
    memory.record("large-1", [{ kind: "user", text: largeText }]);
    memory.record("large-2", [{ kind: "mira", text: largeText }]);

    // Trigger pump/work
    memory.pump();
    expect(compactorMock).toHaveBeenCalled();
  });

  it("aborts deferred compaction on close and late completion does not publish", async () => {
    const platform = createTestScopePlatform();
    let resolveCompactor!: (summary: string) => void;
    const compactorPromise = new Promise<string>((resolve) => {
      resolveCompactor = resolve;
    });

    const compactor = vi.fn(async (_ctx: string, _task: string, _signal: AbortSignal) => {
      return compactorPromise;
    });

    const trackedWork: Promise<void>[] = [];
    const memory = new Memory(platform.storage, compactor, (work) => {
      trackedWork.push(work);
    });

    // Queue big text that needs compaction
    const largeText = "B".repeat(600);
    memory.record("big-1", [{ kind: "user", text: largeText }]);
    memory.record("big-2", [{ kind: "mira", text: largeText }]);

    memory.pump();

    // Close immediately before compactor finishes
    memory.close();

    // Resolve compactor AFTER close
    resolveCompactor("late-summary");

    // Await tracked real work (await work not sleep!)
    await Promise.all(trackedWork);

    // Assert no node/job completion write or publication occurred
    const nodes = platform.storage.sql
      .exec<{ text: string }>("SELECT text FROM mira_memory_node WHERE text = 'late-summary'")
      .toArray();
    expect(nodes).toHaveLength(0);

    const tree = memory.tree();
    const hasLateSummary = tree?.nodes.some((n) => n.text === "late-summary") ?? false;
    expect(hasLateSummary).toBe(false);
  });
});
