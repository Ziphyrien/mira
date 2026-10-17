import { QueryClient } from "@tanstack/query-core";
import { http } from "#lib/app/http.js";
import type { ReadonlyView } from "#lib/app/feature.js";
import type { MemoryTree, MemoryTreeNode } from "#lib/contracts/index.js";
import type { ConversationSnapshot } from "#lib/plugins/conversation/ports.js";
import type { MemoryPort } from "./api.js";

const key = (node: MemoryTreeNode) => `${node.id}+${node.n}`;
const rootKey = ["root"] as const;
const nodeKey = (epoch: string, node: MemoryTreeNode) => ["node", epoch, key(node)] as const;
const staleTime = 30_000;
const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

export class MemoryState implements MemoryPort {
  #client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        // The host owns retention; retries remain explicit user actions.
        gcTime: Infinity,
        retry: false,
        networkMode: "always",
      },
    },
  });
  #revision = $state(0);
  #root = $derived.by(() => {
    void this.#revision;
    return this.#client.getQueryState<MemoryTree>(rootKey);
  });
  // Read-only projections of QueryCache, never a second writable cache.
  #nodes = $derived.by(() => {
    void this.#revision;
    const cache: Record<string, MemoryTree> = {};
    const pending: Record<string, boolean> = {};
    const failures: Record<string, string> = {};
    for (const query of this.#client.getQueryCache().findAll({ queryKey: ["node"] })) {
      const id = String(query.queryKey[2]);
      const state = this.#client.getQueryState<MemoryTree>(query.queryKey)!;
      if (state.data) cache[id] = state.data;
      pending[id] = state.fetchStatus === "fetching";
      failures[id] = state.status === "error" ? message(state.error, "无法展开摘要") : "";
    }
    return { cache, pending, failures };
  });
  root = $derived(this.#root?.data);
  loading = $derived(this.#root?.fetchStatus === "fetching");
  error = $derived(
    this.#root?.status === "error" ? message(this.#root.error, "无法读取摘要视图") : "",
  );
  cache = $derived(this.#nodes.cache);
  pending = $derived(this.#nodes.pending);
  failures = $derived(this.#nodes.failures);
  opened = $state<Record<string, boolean>>({});
  #queue = new Map<string, MemoryTreeNode>();
  #generation = 0;
  #disposed = false;
  #unsubscribe: () => void;
  #unsubscribeCache: () => void;

  constructor(activity: ReadonlyView<ConversationSnapshot>) {
    this.#unsubscribeCache = this.#client.getQueryCache().subscribe(() => {
      this.#revision++;
    });
    let generating = false;
    this.#unsubscribe = activity.subscribe((snapshot) => {
      const active = snapshot.serverBusy || snapshot.matches("streaming");
      if (generating && !active) void this.refresh();
      generating = active;
    });
    void this.prefetch();
  }

  prefetch(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    const query = this.#client.getQueryCache().find({ queryKey: rootKey });
    if (query?.state.fetchStatus === "fetching") return this.#readRoot();
    if (query && !query.isStaleByTime(staleTime)) return Promise.resolve();
    return this.refresh();
  }

  refresh(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    this.#generation++;
    this.#queue.clear();
    this.opened = {};
    this.#client.removeQueries({ queryKey: ["node"] });
    // Cancellation and invalidation update the cache synchronously. Keep the last root
    // visible while its replacement loads, and leave failed refreshes retryable.
    void this.#client.cancelQueries({ queryKey: rootKey });
    void this.#client.invalidateQueries({ queryKey: rootKey, refetchType: "none" });
    return this.#readRoot();
  }

  async #readRoot() {
    const generation = this.#generation;
    try {
      const page = await this.#client.query({
        queryKey: rootKey,
        staleTime,
        queryFn: ({ signal }) => http<MemoryTree>("/api/memory/tree", { signal }),
      });
      if (!this.#disposed && generation === this.#generation) {
        for (const node of page.nodes.slice(0, 2)) this.prefetchNode(node);
      }
    } catch {
      // QueryCache exposes errors; background prefetch and cancellation must not reject.
    }
  }

  prefetchNode(node: MemoryTreeNode) {
    if (this.#disposed || !this.root || this.loading) return;
    const state = this.#client.getQueryState(nodeKey(this.root.epoch, node));
    if (state?.data || state?.fetchStatus === "fetching" || state?.status === "error") return;
    this.#queue.set(key(node), node);
    this.#drain();
  }

  #drain() {
    while (this.#client.isFetching({ queryKey: ["node"] }) < 2 && this.#queue.size) {
      const node = this.#queue.values().next().value!;
      this.#queue.delete(key(node));
      void this.load(node);
    }
  }

  async load(node: MemoryTreeNode): Promise<void> {
    if (this.#disposed || !this.root || this.loading) return;
    const epoch = this.root.epoch;
    const generation = this.#generation;
    this.#queue.delete(key(node));
    try {
      await this.#client.query({
        queryKey: nodeKey(epoch, node),
        queryFn: async ({ signal }) => {
          const page = await http<MemoryTree>(`/api/memory/tree?id=${node.id}&n=${node.n}`, {
            signal,
          });
          if (page.epoch !== epoch) throw new Error("对话已更新，请刷新摘要视图。");
          return page;
        },
      });
    } catch {
      // Failed nodes remain retryable by load(), but speculative prefetch skips them.
    } finally {
      if (!this.#disposed && generation === this.#generation) this.#drain();
    }
  }

  toggle(node: MemoryTreeNode) {
    if (this.#disposed) return;
    const id = key(node);
    this.opened[id] = !this.opened[id];
    if (this.opened[id]) void this.load(node);
  }

  collapse() {
    this.opened = {};
  }

  #clear() {
    this.#generation++;
    this.#queue.clear();
    this.opened = {};
    // Removing queries aborts their transport signals and discards their results.
    this.#client.clear();
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe();
    this.#clear();
    this.#unsubscribeCache();
  }
}
