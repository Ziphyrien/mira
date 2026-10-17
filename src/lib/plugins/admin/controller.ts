import { QueryClient } from "@tanstack/query-core";
import { abortable, requestSignal } from "#lib/app/cancellation.js";
import { http } from "#lib/app/http.js";
import type { SpaceDetail, SpaceSummary } from "#lib/contracts/index.js";

export type SpaceList = {
  items: SpaceSummary[];
  total: number;
  messages: number;
  cost: number;
};

export type AdminSnapshot = {
  readonly admin: boolean | null;
  readonly token: string;
  readonly query: string;
  readonly list: SpaceList | null;
  readonly detailId: string | null;
  readonly detailError: string;
  readonly detail: (SpaceDetail & { id: string }) | null;
  readonly error: string;
  readonly loginError: string;
  readonly loading: boolean;
  readonly revision: number;
};

export type AdminTransport = (path: string, init?: RequestInit) => Promise<unknown>;

export interface AdminControllerOptions {
  transport?: AdminTransport;
  initial?: { admin: boolean };
}

export class AdminController {
  readonly #transport: AdminTransport;
  #snapshot: AdminSnapshot;
  readonly #subscribers = new Set<(snapshot: AdminSnapshot) => void>();
  #disposed = false;
  readonly #prefetchQueue = new Set<string>();
  readonly #details = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, gcTime: Infinity, retry: false, networkMode: "always" },
    },
  });

  #initialAdmin: boolean | undefined;
  #initSeq = 0;
  #listSeq = 0;
  #detailSeq = 0;
  #actionSeq = 0;

  #initCtrl: AbortController | null = null;
  #listCtrl: AbortController | null = null;
  #detailCtrl: AbortController | null = null;
  #actionCtrl: AbortController | null = null;

  constructor(options?: AdminControllerOptions) {
    this.#transport = options?.transport ?? http;
    this.#initialAdmin = options?.initial?.admin ?? undefined;
    this.#snapshot = Object.freeze({
      admin: options?.initial?.admin ?? null,
      token: "",
      query: "",
      list: null,
      detailId: null,
      detailError: "",
      detail: null,
      error: "",
      loginError: "",
      loading: false,
      revision: 0,
    });
  }

  get snapshot(): AdminSnapshot {
    return this.#snapshot;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  subscribe(callback: (snapshot: AdminSnapshot) => void): () => void {
    if (this.#disposed) return () => {};
    this.#subscribers.add(callback);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  #publish(patch: Partial<AdminSnapshot>): void {
    if (this.#disposed) return;
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      ...patch,
      revision: this.#snapshot.revision + 1,
    });
    for (const subscriber of this.#subscribers) {
      subscriber(this.#snapshot);
    }
  }

  #request(path: string, init: RequestInit): Promise<unknown> {
    const signal = init.signal ?? undefined;
    signal?.throwIfAborted();
    return abortable(this.#transport(path, init), signal);
  }

  #clearDetail(): void {
    this.#detailSeq++;
    this.#detailCtrl?.abort();
    this.#detailCtrl = null;
    this.#prefetchQueue.clear();
    this.#details.clear();
    this.#publish({ detailId: null, detail: null, detailError: "" });
  }

  async initialize(caller?: AbortSignal): Promise<void> {
    if (this.#disposed || caller?.aborted) return;
    if (this.#initialAdmin !== undefined) {
      const authenticated = this.#initialAdmin;
      this.#initialAdmin = undefined;
      if (authenticated) await this.list(this.#snapshot.query, caller);
      return;
    }
    this.#initCtrl?.abort();
    const ctrl = new AbortController();
    const signal = requestSignal(ctrl.signal, caller);
    this.#initCtrl = ctrl;
    const seq = ++this.#initSeq;

    this.#publish({ error: "", loading: true });

    try {
      const res = (await this.#request("/api/admin/session", {
        signal,
      })) as { admin: boolean };
      if (this.#disposed || signal.aborted || seq !== this.#initSeq) return;
      if (!res.admin) {
        this.#listSeq++;
        this.#listCtrl?.abort();
        this.#clearDetail();
        this.#publish({ admin: false, list: null, detail: null, loading: false });
      } else {
        this.#publish({ admin: true, loading: false });
      }
      if (res.admin) {
        await this.list(this.#snapshot.query, caller);
      }
    } catch (err) {
      if (this.#disposed || seq !== this.#initSeq || signal.aborted) return;
      const message = err instanceof Error ? err.message : "请求失败，请重试。";
      this.#publish({ error: message, loading: false });
    } finally {
      if (this.#initCtrl === ctrl) this.#initCtrl = null;
    }
  }

  async login(token: string, caller?: AbortSignal): Promise<void> {
    if (this.#disposed || caller?.aborted) return;
    this.#initialAdmin = undefined;
    this.#initCtrl?.abort();
    this.#initSeq++;
    this.#actionCtrl?.abort();
    const ctrl = new AbortController();
    const signal = requestSignal(ctrl.signal, caller);
    this.#actionCtrl = ctrl;
    const seq = ++this.#actionSeq;

    this.#clearDetail();
    this.#publish({ loginError: "", error: "", token, loading: true });

    try {
      await this.#request("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        signal,
      });
      if (this.#disposed || signal.aborted || seq !== this.#actionSeq) return;
      this.#publish({ admin: true, token: "", loginError: "", loading: false });
      await this.list(this.#snapshot.query, caller);
    } catch (err) {
      if (this.#disposed || seq !== this.#actionSeq || signal.aborted) return;
      const message = err instanceof Error ? err.message : "登录失败";
      this.#publish({ loginError: message, loading: false });
    } finally {
      if (this.#actionCtrl === ctrl) this.#actionCtrl = null;
    }
  }

  async logout(caller?: AbortSignal): Promise<void> {
    if (this.#disposed || caller?.aborted) return;
    this.#initialAdmin = undefined;
    this.#initCtrl?.abort();
    this.#initSeq++;
    this.#listSeq++;
    this.#listCtrl?.abort();
    this.#clearDetail();
    this.#actionCtrl?.abort();
    const ctrl = new AbortController();
    const signal = requestSignal(ctrl.signal, caller);
    this.#actionCtrl = ctrl;
    const seq = ++this.#actionSeq;

    try {
      await this.#request("/api/admin/session", {
        method: "DELETE",
        signal,
      });
      if (this.#disposed || signal.aborted || seq !== this.#actionSeq) return;
      this.#publish({ admin: false, list: null, detail: null, error: "", loading: false });
    } catch (err) {
      if (this.#disposed || seq !== this.#actionSeq || signal.aborted) return;
      const message = err instanceof Error ? err.message : "退出失败";
      this.#publish({ error: message, loading: false });
    } finally {
      if (this.#actionCtrl === ctrl) this.#actionCtrl = null;
    }
  }

  async list(query?: string | null, caller?: AbortSignal): Promise<void> {
    if (this.#disposed || caller?.aborted) return;
    const q = query !== undefined && query !== null ? query : this.#snapshot.query;
    this.#prefetchQueue.clear();
    void this.#details.cancelQueries({
      predicate: (detail) => detail.queryKey[1] !== this.#snapshot.detailId,
    });
    this.#listCtrl?.abort();
    const ctrl = new AbortController();
    const signal = requestSignal(ctrl.signal, caller);
    this.#listCtrl = ctrl;
    const seq = ++this.#listSeq;

    this.#publish({ query: q, error: "", loading: true });

    try {
      const data = (await this.#request(`/api/admin/spaces?q=${encodeURIComponent(q)}`, {
        signal,
      })) as SpaceList;
      if (this.#disposed || signal.aborted || seq !== this.#listSeq) return;
      void this.#details.invalidateQueries({ refetchType: "none" });
      this.#publish({ list: data, loading: false });
      for (const { id } of data.items) this.#prefetchQueue.add(id);
      this.#drainPrefetch();
    } catch (err) {
      if (this.#disposed || seq !== this.#listSeq || signal.aborted) return;
      const message = err instanceof Error ? err.message : "加载空间列表失败";
      this.#publish({ error: message, loading: false });
    } finally {
      if (this.#listCtrl === ctrl) this.#listCtrl = null;
    }
  }

  #loadDetail(id: string): Promise<SpaceDetail> {
    return this.#details.query({
      queryKey: ["detail", id],
      queryFn: async ({ signal }) =>
        (await this.#request(`/api/admin/spaces/${encodeURIComponent(id)}`, {
          signal,
        })) as SpaceDetail,
    });
  }

  #drainPrefetch(): void {
    if (this.#disposed || !this.#snapshot.admin) return;
    while (this.#details.isFetching() < 3 && this.#prefetchQueue.size) {
      const id = this.#prefetchQueue.values().next().value!;
      this.#prefetchQueue.delete(id);
      void this.#prefetch(id);
    }
  }

  async #prefetch(id: string): Promise<void> {
    try {
      await this.#loadDetail(id);
    } catch {
      // One failed detail must not block the rest of the list or display an alert.
    } finally {
      this.#drainPrefetch();
    }
  }

  async open(id: string | null, caller?: AbortSignal): Promise<void> {
    if (this.#disposed || caller?.aborted) return;
    this.#detailCtrl?.abort();
    if (id === null) {
      this.#detailSeq++;
      this.#detailCtrl = null;
      // Keep rendered content stable during the native dialog exit transition.
      this.#publish({ detailId: null });
      return;
    }
    const ctrl = new AbortController();
    const signal = requestSignal(ctrl.signal, caller);
    this.#detailCtrl = ctrl;
    const seq = ++this.#detailSeq;

    // A selected detail bypasses the background queue and shares any in-flight request.
    this.#prefetchQueue.delete(id);
    const cached = this.#details.getQueryData<SpaceDetail>(["detail", id]);
    this.#publish({ detailId: id, detail: cached ? { id, ...cached } : null, detailError: "" });
    const cancel = () => {
      void this.#details.cancelQueries({ queryKey: ["detail", id], exact: true });
    };
    signal.addEventListener("abort", cancel, { once: true });

    try {
      const data = await abortable(this.#loadDetail(id), signal);
      if (this.#disposed || signal.aborted || seq !== this.#detailSeq) return;
      this.#publish({ detail: { id, ...data } });
    } catch (err) {
      if (this.#disposed || seq !== this.#detailSeq) return;
      if (signal.aborted) {
        this.#publish({ detailId: null });
        return;
      }
      const message = err instanceof Error ? err.message : "加载空间详情失败";
      this.#publish({ detailError: message });
    } finally {
      signal.removeEventListener("abort", cancel);
      if (this.#detailCtrl === ctrl) this.#detailCtrl = null;
      this.#drainPrefetch();
    }
  }

  async delete(id: string, caller?: AbortSignal): Promise<void> {
    if (this.#disposed || caller?.aborted) return;
    this.#actionCtrl?.abort();
    const ctrl = new AbortController();
    const signal = requestSignal(ctrl.signal, caller);
    this.#actionCtrl = ctrl;
    const seq = ++this.#actionSeq;

    this.#publish({ error: "" });

    try {
      await this.#request(`/api/admin/spaces/${encodeURIComponent(id)}`, {
        method: "DELETE",
        signal,
      });
      if (this.#disposed || signal.aborted || seq !== this.#actionSeq) return;
      this.#prefetchQueue.delete(id);
      this.#details.removeQueries({ queryKey: ["detail", id], exact: true });
      if (this.#snapshot.detailId === id) {
        await this.open(null);
      }
      await this.list(this.#snapshot.query, caller);
    } catch (err) {
      if (this.#disposed || seq !== this.#actionSeq || signal.aborted) return;
      const message = err instanceof Error ? err.message : "删除空间失败";
      this.#publish({ error: message });
    } finally {
      if (this.#actionCtrl === ctrl) this.#actionCtrl = null;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#initCtrl?.abort();
    this.#listCtrl?.abort();
    this.#detailCtrl?.abort();
    this.#actionCtrl?.abort();
    this.#initCtrl = null;
    this.#listCtrl = null;
    this.#detailCtrl = null;
    this.#actionCtrl = null;
    this.#prefetchQueue.clear();
    this.#details.clear();
    this.#subscribers.clear();
  }
}
