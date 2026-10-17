import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SearchState } from "#lib/plugins/search/state.svelte.js";
import { HistoryController } from "#lib/plugins/history/history.js";
import { HistoryNavigation } from "#lib/plugins/history/navigation.js";
import type { Row } from "#lib/contracts/index.js";

afterEach(() => vi.unstubAllGlobals());

describe("search dialog lifecycle", () => {
  it("indexes older pages beyond the latest 200 and navigates through the history owner", async () => {
    const latest: Row[] = Array.from({ length: 200 }, (_, n) => ({
      i: n + 201,
      kind: "user",
      text: `recent ${n}`,
      at: n + 201,
    }));
    const oldest: Row = { i: 1, kind: "user", text: "older unique needle", at: 1 };
    const older = Promise.withResolvers<Response>();
    const paths: string[] = [];
    vi.stubGlobal("fetch", (path: string) => {
      paths.push(path);
      if (path === "/api/history?limit=200")
        return Promise.resolve(Response.json({ messages: latest, nextBefore: 201 }));
      if (path === "/api/history?limit=200&before=201") return older.promise;
      if (path === "/api/history?before=201")
        return Promise.resolve(Response.json({ messages: [oldest], nextBefore: null }));
      throw new Error(`Unexpected request ${path}`);
    });
    const history = new HistoryController({ initialRows: latest, initialNextBefore: 201 });
    const navigation = new HistoryNavigation();
    navigation.attach({
      scrollDown: async () => {},
      jump: (row, signal) => history.loadUntil(row.i, signal),
    });
    const search = new SearchState(navigation);
    try {
      search.open();
      search.setQuery("needle");
      await vi.waitFor(() => expect(search.indexed).toBe(200));
      expect(search.loading).toBe(true);
      older.resolve(Response.json({ messages: [oldest], nextBefore: null }));
      await vi.waitFor(() => expect(search.loading).toBe(false));
      expect(search.indexed).toBe(201);
      expect(search.results.map((row) => row.i)).toEqual([1]);
      await search.pick(search.results[0]);
      expect(history.snapshot.rows[0]).toEqual(oldest);
      expect(search.opened).toBe(false);
      expect(paths).toContain("/api/history?before=201");
    } finally {
      search.dispose();
      history.dispose();
      navigation.dispose();
    }
  });

  it.each([
    { name: "failed history load", result: new Error("无法读取更早消息，请重试。") },
    { name: "removed result or missing DOM", result: false },
  ])(
    "keeps query and dialog available after $name and permits selection retry",
    async ({ result }) => {
      const selected: Row = { i: 3, kind: "user", text: "needle", at: 3 };
      vi.stubGlobal("fetch", async () => Response.json({ messages: [selected], nextBefore: null }));
      const jump = vi.fn<(row: Row, signal?: AbortSignal) => Promise<boolean>>();
      if (result instanceof Error) jump.mockRejectedValueOnce(result);
      else jump.mockResolvedValueOnce(result);
      jump.mockResolvedValueOnce(true);
      const search = new SearchState({ jump });
      try {
        search.open();
        search.setQuery("needle");
        await vi.waitFor(() => expect(search.loading).toBe(false));
        await search.pick(selected);
        expect(search.opened).toBe(true);
        expect(search.query).toBe("needle");
        expect(search.results).toEqual([selected]);
        expect(search.error).toContain("重试");
        await search.pick(selected);
        expect(search.opened).toBe(false);
      } finally {
        search.dispose();
      }
    },
  );

  it("silences cancelled navigation and aborts pagination without starting another page", async () => {
    const page = Promise.withResolvers<Response>();
    const fetcher = vi.fn(() => page.promise);
    vi.stubGlobal("fetch", fetcher);
    const search = new SearchState({
      jump: async () => {
        throw new DOMException("superseded", "AbortError");
      },
    });
    try {
      search.open();
      search.setQuery("keep");
      await search.pick({ i: 1, kind: "user", text: "keep", at: 1 });
      expect(search.error).toBe("");
      expect(search.opened).toBe(true);
      search.close();
      page.resolve(Response.json({ messages: [], nextBefore: 200 }));
      await page.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      search.dispose();
    }
  });
  it("ignores a closed dialog request after reopening and aborts its active request on disposal", async () => {
    const first = Promise.withResolvers<Response>();
    const second = Promise.withResolvers<Response>();
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return signals.length === 1 ? first.promise : second.promise;
    });
    const search = new SearchState({ jump: async () => true });
    try {
      search.open();
      search.close();
      expect(signals[0].aborted).toBe(true);
      search.open();
      search.setQuery("coffee");
      second.resolve(
        Response.json({
          messages: [{ i: 2, kind: "user", text: "coffee today", at: 2 }],
          nextBefore: null,
        }),
      );
      await vi.waitFor(() => expect(search.loading).toBe(false));
      first.resolve(
        Response.json({
          messages: [{ i: 1, kind: "user", text: "coffee yesterday", at: 1 }],
          nextBefore: null,
        }),
      );
      await first.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(search.results.map((row) => row.i)).toEqual([2]);
      search.dispose();
      expect(signals[1].aborted).toBe(true);
      expect(search.opened).toBe(false);
      expect(search.results).toEqual([]);
    } finally {
      search.dispose();
    }
  });
  it("does not close a new dialog when navigation selected in an old dialog finishes", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ messages: [], nextBefore: null }));
    const navigation = Promise.withResolvers<boolean>();
    const selected: Row = { i: 3, kind: "user", text: "selected", at: 3 };
    const jump = vi.fn(() => navigation.promise);
    const search = new SearchState({ jump });
    try {
      search.open();
      const picking = search.pick(selected);
      search.close();
      search.open();
      search.setQuery("new query");
      navigation.resolve(true);
      await picking;
      expect(jump).toHaveBeenCalledWith(selected, expect.any(AbortSignal));
      expect(search.opened).toBe(true);
      expect(search.query).toBe("new query");
    } finally {
      search.dispose();
    }
  });
});
