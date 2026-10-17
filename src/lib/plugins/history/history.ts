import { abortable, requestSignal } from "#lib/app/cancellation.js";
import type { Row, HistoryPage } from "#lib/contracts/index.js";
import { http } from "#lib/app/http.js";
import type { HistorySnapshot, PrependResult } from "./ports.js";

/** Narrow transport contract for history page retrieval. */
export type HistoryTransport = {
  fetchHistory: (before: number, signal?: AbortSignal) => Promise<HistoryPage>;
};

/** Production default transport calling the /api/history endpoint. */
const defaultHistoryTransport: HistoryTransport = {
  async fetchHistory(before: number, signal?: AbortSignal): Promise<HistoryPage> {
    return http<HistoryPage>(`/api/history?before=${before}`, { signal });
  },
};

export type HistoryOptions = {
  initialRows?: Row[];
  initialNextBefore?: number | null;
  transport?: HistoryTransport;
};

/**
 * Pure TypeScript observable controller managing message history pages,
 * prefetch deduplication, revision fencing on reset/replace, prepend deduplication,
 * and search result paging.
 */
export class HistoryController {
  #rows: Row[] = [];
  #nextBefore: number | null = null;
  #loading = false;
  #error: string | null = null;
  #prefetched: HistoryPage | null = null;
  #revision = 0;
  #prepending = false;

  #transport: HistoryTransport;
  #activeController: AbortController | null = null;
  #activeTask: Promise<HistoryPage | null> | null = null;

  #subscribers = new Set<(snapshot: HistorySnapshot) => void>();
  #snapshot: HistorySnapshot;

  constructor(options: HistoryOptions = {}) {
    this.#rows = options.initialRows ? [...options.initialRows] : [];
    this.#nextBefore = options.initialNextBefore ?? null;
    this.#transport = options.transport ?? defaultHistoryTransport;
    this.#snapshot = this.#createSnapshot();
  }

  get snapshot(): HistorySnapshot {
    return this.#snapshot;
  }

  subscribe(callback: (snapshot: HistorySnapshot) => void): () => void {
    this.#subscribers.add(callback);
    callback(this.#snapshot);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  reset(): void {
    this.#invalidatePages();
    this.#error = null;
    this.#emit();
  }

  replace(rows: Row[], nextBefore: number | null): void {
    this.#invalidatePages();
    this.#error = null;
    this.#rows = [...rows];
    this.#nextBefore = nextBefore;
    this.#emit();
  }

  applyMessages(messages: Row[]): void {
    this.reset();
    const first = messages[0]?.i ?? Number.MAX_SAFE_INTEGER;
    this.#rows = [...this.#rows.filter((row) => row.i >= 0 && row.i < first), ...messages];
    this.#emit();
  }

  prefetchEarlier(caller?: AbortSignal): Promise<HistoryPage | null> {
    if (caller?.aborted) return Promise.resolve(null);
    if (this.#prefetched || this.#nextBefore === null || this.#error) {
      return Promise.resolve(this.#prefetched);
    }
    if (this.#activeTask) {
      return abortable(this.#activeTask, caller);
    }

    const cursor = this.#nextBefore;
    const requestRevision = this.#revision;
    const controller = new AbortController();
    const signal = requestSignal(controller.signal, caller);
    this.#activeController = controller;
    this.#loading = true;
    this.#emit();

    this.#activeTask = (async () => {
      try {
        const page = await abortable(this.#transport.fetchHistory(cursor, signal), signal);
        if (!signal.aborted && requestRevision === this.#revision && cursor === this.#nextBefore) {
          this.#prefetched = page;
          this.#error = null;
          return page;
        }
        return null;
      } catch (err) {
        if (!signal.aborted && requestRevision === this.#revision) {
          this.#error = err instanceof Error ? err.message : "无法加载更早的消息";
        }
        return null;
      } finally {
        if (this.#activeController === controller) {
          this.#activeController = null;
          this.#activeTask = null;
          this.#loading = false;
          if (requestRevision === this.#revision) {
            this.#emit();
          }
        }
      }
    })();

    return this.#activeTask;
  }

  prependEarlier(): PrependResult {
    if (this.#prepending || !this.#prefetched) {
      return {
        prepended: false,
        count: 0,
        revision: this.#revision,
        previousFirstId: null,
      };
    }

    const page = this.#prefetched;
    const revision = this.#revision;
    const firstRow = this.#rows.find((row) => row.i >= 0);
    const firstId = firstRow ? firstRow.i : Number.MAX_SAFE_INTEGER;

    this.#prepending = true;
    this.#prefetched = null;
    this.#nextBefore = page.nextBefore;

    try {
      const incoming = page.messages.filter((row) => row.i < firstId);
      this.#rows = [...incoming, ...this.#rows];
      this.#emit();
      return {
        prepended: incoming.length > 0,
        count: incoming.length,
        revision,
        previousFirstId: firstRow ? firstRow.i : null,
      };
    } finally {
      this.#prepending = false;
    }
  }

  async loadEarlier(): Promise<PrependResult> {
    if (!this.#prefetched && this.#nextBefore !== null && !this.#error) {
      await this.prefetchEarlier();
    }
    return this.prependEarlier();
  }

  async loadUntil(targetId: number, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    if (this.#error) await this.retry(signal);
    const revision = this.#revision;
    while (!this.hasRow(targetId) && this.#nextBefore !== null && !this.#error) {
      if (this.#revision !== revision) return false;
      const prevBefore = this.#nextBefore;
      await this.prefetchEarlier(signal);
      signal?.throwIfAborted();
      if (this.#revision !== revision || this.#error) return false;
      const res = this.prependEarlier();
      if (!res.prepended && this.#nextBefore === prevBefore) {
        break;
      }
      if (!res.prepended && this.#nextBefore === null) break;
    }
    return this.hasRow(targetId);
  }

  hasRow(id: number): boolean {
    return this.#rows.some((row) => row.i === id);
  }

  async retry(signal?: AbortSignal): Promise<void> {
    this.#error = null;
    this.#emit();
    await this.prefetchEarlier(signal);
  }

  dispose(): void {
    this.#invalidatePages();
    this.#snapshot = this.#createSnapshot();
    this.#subscribers.clear();
  }

  #invalidatePages(): void {
    this.#revision++;
    this.#activeController?.abort();
    this.#activeController = null;
    this.#activeTask = null;
    this.#prefetched = null;
    this.#loading = false;
  }

  #createSnapshot(): HistorySnapshot {
    return Object.freeze({
      rows: this.#rows,
      nextBefore: this.#nextBefore,
      loading: this.#loading,
      error: this.#error,
      prefetched: this.#prefetched,
      revision: this.#revision,
    });
  }

  #emit(): void {
    this.#snapshot = this.#createSnapshot();
    for (const sub of this.#subscribers) {
      sub(this.#snapshot);
    }
  }
}
