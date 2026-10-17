import { afterEach, expect, it, vi } from "vite-plus/test";
import type { MemoryTree } from "#lib/contracts/index.js";
import { ConversationController } from "#lib/plugins/conversation/controller.js";
import { MemoryState } from "./state.svelte.js";

const tree: MemoryTree = {
  epoch: "first",
  total: 1,
  nodes: [{ id: 1, n: 1, ready: true, text: "A saved memory" }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("refreshes cached summaries once when conversation activity returns to idle", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ...tree, nodes: [] }))
    .mockResolvedValueOnce(Response.json({ ...tree, epoch: "updated", nodes: [] }));
  vi.stubGlobal("fetch", fetcher);
  const activity = new ConversationController();
  const memory = new MemoryState(activity);
  try {
    await memory.prefetch();
    activity.setServerBusy(true);
    await memory.prefetch();
    expect(fetcher).toHaveBeenCalledTimes(1);
    activity.setServerBusy(false);
    await memory.prefetch();
    expect(memory.root?.epoch).toBe("updated");
    expect(fetcher).toHaveBeenCalledTimes(2);
    activity.setServerBusy(false);
    await memory.prefetch();
    expect(fetcher).toHaveBeenCalledTimes(2);
    memory.dispose();
    activity.setServerBusy(true);
    activity.setServerBusy(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    memory.dispose();
    activity.dispose();
  }
});

it("isolates account caches and cancellation while another host is still loading", async () => {
  const otherPage = Promise.withResolvers<Response>();
  const signals: AbortSignal[] = [];
  const fetcher = vi.fn((_path: string, init: RequestInit) => {
    signals.push(init.signal as AbortSignal);
    return signals.length === 1
      ? Promise.resolve(Response.json({ ...tree, nodes: [] }))
      : otherPage.promise;
  });
  vi.stubGlobal("fetch", fetcher);
  const activity = new ConversationController();
  const first = new MemoryState(activity);
  await first.prefetch();
  const other = new MemoryState(activity);
  try {
    const loading = other.prefetch();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(first.root?.epoch).toBe("first");
    expect(other.root).toBeUndefined();
    first.dispose();
    expect(signals[1].aborted).toBe(false);
    otherPage.resolve(Response.json({ ...tree, epoch: "other account", nodes: [] }));
    await loading;
    expect(other.root?.epoch).toBe("other account");
    expect(first.root).toBeUndefined();
    expect(other.loading).toBe(false);
  } finally {
    first.dispose();
    other.dispose();
    activity.dispose();
  }
});

it("expires the summary cache after thirty seconds and permits retry after a failed refresh", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ...tree, nodes: [] }))
    .mockResolvedValueOnce(Response.json({ message: "try again" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ...tree, epoch: "updated", nodes: [] }));
  vi.stubGlobal("fetch", fetcher);
  const activity = new ConversationController();
  const memory = new MemoryState(activity);
  try {
    await memory.prefetch();
    clock.mockReturnValue(30_999);
    await memory.prefetch();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(memory.root?.epoch).toBe("first");

    clock.mockReturnValue(31_000);
    await memory.prefetch();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(memory.loading).toBe(false);
    expect(memory.error).toBe("try again");
    expect(memory.root?.epoch).toBe("first");
    await memory.prefetch();
    expect(memory.root?.epoch).toBe("updated");
    expect(memory.error).toBe("");
  } finally {
    memory.dispose();
    activity.dispose();
  }
});

it("bounds speculative node loading, prioritizes selection and reuses work without traversing descendants", async () => {
  const nodes = Array.from({ length: 4 }, (_, i) => ({
    id: i + 1,
    n: 1,
    ready: true,
    text: `memory ${i}`,
  }));
  const pages = nodes.map(() => Promise.withResolvers<Response>());
  const requested: number[] = [];
  vi.stubGlobal("fetch", (path: string) => {
    if (path === "/api/memory/tree") return Promise.resolve(Response.json({ ...tree, nodes }));
    const id = Number(new URL(path, "https://mira.test").searchParams.get("id"));
    requested.push(id);
    if (!pages[id - 1]) throw new Error("Unexpected recursive prefetch");
    return pages[id - 1].promise;
  });
  const activity = new ConversationController();
  const memory = new MemoryState(activity);
  try {
    await memory.prefetch();
    memory.prefetchNode(nodes[2]);
    memory.prefetchNode(nodes[3]);
    expect(requested).toEqual([1, 2]);
    const selected = memory.load(nodes[3]);
    memory.prefetchNode(nodes[3]);
    memory.toggle(nodes[3]);
    expect(requested).toEqual([1, 2, 4]);

    pages[3].resolve(
      Response.json({ ...tree, nodes: [{ id: 10, n: 1, ready: true, text: "descendant" }] }),
    );
    await selected;
    expect(requested).toEqual([1, 2, 4]);
    pages[0].resolve(Response.json({ ...tree, nodes: [] }));
    await memory.load(nodes[0]);
    expect(requested).toEqual([1, 2, 4, 3]);
    pages[1].resolve(Response.json({ ...tree, epoch: "changed" }));
    await memory.load(nodes[1]);
    expect(memory.cache["2+1"]).toBeUndefined();
    expect(memory.failures["2+1"]).toContain("对话已更新");
    memory.prefetchNode(nodes[1]);
    pages[2].resolve(Response.json({ ...tree, nodes: [] }));
    await memory.load(nodes[2]);
    expect(requested).toEqual([1, 2, 4, 3]);
    expect(memory.cache["4+1"].nodes[0].id).toBe(10);

    pages[1] = Promise.withResolvers<Response>();
    const retry = memory.load(nodes[1]);
    expect(memory.pending["2+1"]).toBe(true);
    expect(memory.failures["2+1"]).toBe("");
    pages[1].resolve(Response.json({ ...tree, nodes: [] }));
    await retry;
    expect(memory.pending["2+1"]).toBe(false);
    expect(memory.cache["2+1"].epoch).toBe("first");
    await memory.load(nodes[1]);
    expect(requested).toEqual([1, 2, 4, 3, 2]);
  } finally {
    memory.dispose();
    activity.dispose();
  }
});

it("cancels replaced requests even within the same epoch and clears data when the account closes", async () => {
  const staleRoot = Promise.withResolvers<Response>();
  const staleChild = Promise.withResolvers<Response>();
  const closingChild = Promise.withResolvers<Response>();
  const signals: AbortSignal[] = [];
  const responses = [
    staleRoot.promise,
    Promise.resolve(Response.json({ ...tree, epoch: "second" })),
    staleChild.promise,
    Promise.resolve(Response.json({ ...tree, epoch: "second" })),
    closingChild.promise,
  ];
  vi.stubGlobal("fetch", (_path: string, init: RequestInit) => {
    signals.push(init.signal as AbortSignal);
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request after disposal");
    return response;
  });
  const activity = new ConversationController();
  const memory = new MemoryState(activity);
  try {
    const initial = memory.prefetch();
    await memory.refresh();
    expect(signals[0].aborted).toBe(true);
    staleRoot.resolve(Response.json(tree));
    await initial;
    expect(memory.root?.epoch).toBe("second");

    const child = memory.load(tree.nodes[0]);
    const refreshing = memory.refresh();
    expect(memory.root?.epoch).toBe("second");
    await refreshing;
    expect(signals[2].aborted).toBe(true);
    staleChild.resolve(Response.json({ ...tree, epoch: "second" }));
    await child;
    expect(memory.root?.epoch).toBe("second");
    expect(memory.cache).toEqual({});
    expect(memory.pending["1+1"]).toBe(true);
    expect(memory.failures["1+1"]).toBe("");

    const closing = memory.load(tree.nodes[0]);
    memory.toggle(tree.nodes[0]);
    expect(memory.opened["1+1"]).toBe(true);
    memory.dispose();
    expect(signals[4].aborted).toBe(true);
    closingChild.resolve(Response.json({ ...tree, epoch: "second" }));
    await closing;
    await memory.prefetch();
    expect(signals).toHaveLength(5);
    expect(memory.root).toBeUndefined();
    expect(memory.opened).toEqual({});
    expect(memory.cache).toEqual({});
    expect(memory.loading).toBe(false);
    expect(memory.error).toBe("");
  } finally {
    memory.dispose();
    activity.dispose();
  }
});
