import { describe, it, expect, vi } from "vite-plus/test";
import { HistoryController, type HistoryTransport } from "#lib/plugins/history/history.js";
import type { HistoryPage, Row } from "#lib/contracts/index.js";

function createDeferred<T>() {
  let resolve!: (val: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("HistoryController", () => {
  it("retries a failed navigation page and reports a removed result without claiming success", async () => {
    let unavailable = true;
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        unavailable
          ? Response.json({ message: "history temporarily unavailable" }, { status: 503 })
          : Response.json({
              messages: [{ i: 4, kind: "user", text: "target", at: 4 }],
              nextBefore: null,
            }),
      );
    const history = new HistoryController({
      initialRows: [{ i: 10, kind: "user", text: "recent", at: 10 }],
      initialNextBefore: 10,
    });
    try {
      expect(await history.loadUntil(4)).toBe(false);
      expect(history.snapshot.error).toBe("history temporarily unavailable");
      unavailable = false;
      expect(await history.loadUntil(4)).toBe(true);
      expect(history.snapshot.error).toBeNull();
      expect(await history.loadUntil(3)).toBe(false);
      expect(history.snapshot.error).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      history.dispose();
      fetcher.mockRestore();
    }
  });
  it("stale history completion cannot alter replaced state", async () => {
    const deferred = createDeferred<HistoryPage>();
    const transport: HistoryTransport = {
      fetchHistory: vi.fn(() => deferred.promise),
    };

    const initialRows: Row[] = [{ i: 10, kind: "user", text: "hello", at: 1000 }];
    const controller = new HistoryController({
      initialRows,
      initialNextBefore: 10,
      transport,
    });

    const prefetchPromise = controller.prefetchEarlier();
    expect(controller.snapshot.loading).toBe(true);

    const newRows: Row[] = [{ i: 50, kind: "user", text: "fresh thread", at: 5000 }];
    controller.replace(newRows, 50);

    expect(controller.snapshot.rows).toEqual(newRows);
    expect(controller.snapshot.nextBefore).toBe(50);
    expect(controller.snapshot.loading).toBe(false);

    deferred.resolve({
      messages: [{ i: 5, kind: "mira", text: "old message", at: 500 }],
      nextBefore: 5,
    });

    const prefetchResult = await prefetchPromise;
    expect(prefetchResult).toBeNull();

    expect(controller.snapshot.rows).toEqual(newRows);
    expect(controller.snapshot.nextBefore).toBe(50);
    expect(controller.snapshot.prefetched).toBeNull();
  });

  it("prefetch dedup avoids concurrent redundant requests", async () => {
    const deferred = createDeferred<HistoryPage>();
    const transport: HistoryTransport = {
      fetchHistory: vi.fn(() => deferred.promise),
    };

    const controller = new HistoryController({
      initialRows: [{ i: 10, kind: "user", text: "hi", at: 1000 }],
      initialNextBefore: 10,
      transport,
    });

    const p1 = controller.prefetchEarlier();
    const p2 = controller.prefetchEarlier();

    expect(transport.fetchHistory).toHaveBeenCalledTimes(1);

    deferred.resolve({
      messages: [{ i: 5, kind: "mira", text: "earlier", at: 500 }],
      nextBefore: 5,
    });

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1).toBe(res2);
    expect(controller.snapshot.prefetched?.nextBefore).toBe(5);

    await controller.prefetchEarlier();
    expect(transport.fetchHistory).toHaveBeenCalledTimes(1);
  });

  it("dispose aborts active prefetch request", async () => {
    let capturedSignal: AbortSignal | undefined;
    const deferred = createDeferred<HistoryPage>();
    const transport: HistoryTransport = {
      fetchHistory: vi.fn((_before, signal) => {
        capturedSignal = signal;
        return deferred.promise;
      }),
    };

    const controller = new HistoryController({
      initialRows: [{ i: 10, kind: "user", text: "test", at: 1000 }],
      initialNextBefore: 10,
      transport,
    });

    void controller.prefetchEarlier();
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    controller.dispose();

    expect(capturedSignal?.aborted).toBe(true);
    expect(controller.snapshot.loading).toBe(false);
  });

  it("safe prepend and scroll anchor returns", async () => {
    const customController = new HistoryController({
      initialRows: [
        { i: 3, kind: "user", text: "third", at: 3000 },
        { i: 4, kind: "mira", text: "fourth", at: 4000 },
      ],
      initialNextBefore: 3,
      transport: {
        fetchHistory: async () => ({
          messages: [
            { i: 1, kind: "user", text: "first", at: 1000 },
            { i: 2, kind: "mira", text: "second", at: 2000 },
            { i: 3, kind: "user", text: "duplicate 3", at: 3000 },
          ],
          nextBefore: 1,
        }),
      },
    });

    await customController.prefetchEarlier();
    const result = customController.prependEarlier();
    expect(result.prepended).toBe(true);
    expect(result.count).toBe(2);
    expect(result.previousFirstId).toBe(3);

    const rows = customController.snapshot.rows;
    expect(rows.map((r) => r.i)).toEqual([1, 2, 3, 4]);
    expect(customController.snapshot.nextBefore).toBe(1);
  });

  it("search result loading with loadUntil pages backwards", async () => {
    const pages: Record<number, HistoryPage> = {
      10: {
        messages: [
          { i: 7, kind: "user", text: "seven", at: 700 },
          { i: 8, kind: "mira", text: "eight", at: 800 },
          { i: 9, kind: "user", text: "nine", at: 900 },
        ],
        nextBefore: 7,
      },
      7: {
        messages: [
          { i: 4, kind: "user", text: "target message four", at: 400 },
          { i: 5, kind: "mira", text: "five", at: 500 },
          { i: 6, kind: "mira", text: "six", at: 600 },
        ],
        nextBefore: null,
      },
    };

    const controller = new HistoryController({
      initialRows: [{ i: 10, kind: "user", text: "ten", at: 1000 }],
      initialNextBefore: 10,
      transport: {
        fetchHistory: async (before) => pages[before] ?? { messages: [], nextBefore: null },
      },
    });

    const found = await controller.loadUntil(4);
    expect(found).toBe(true);
    expect(controller.hasRow(4)).toBe(true);
    expect(controller.snapshot.rows[0].i).toBe(4);
  });

  it("separate instances do not leak state", () => {
    const a = new HistoryController({
      initialRows: [{ i: 1, kind: "user", text: "a", at: 1 }],
      initialNextBefore: 1,
    });
    const b = new HistoryController({
      initialRows: [{ i: 2, kind: "user", text: "b", at: 2 }],
      initialNextBefore: 2,
    });

    a.replace([{ i: 100, kind: "user", text: "mutated a", at: 100 }], null);

    expect(a.snapshot.rows[0].i).toBe(100);
    expect(b.snapshot.rows[0].i).toBe(2);
    expect(b.snapshot.nextBefore).toBe(2);
  });
});
