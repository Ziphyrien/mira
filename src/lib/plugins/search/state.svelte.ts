import { http } from "#lib/app/http.js";
import type { HistoryPage, Row } from "#lib/contracts/index.js";
import type { HistoryViewportPort } from "#lib/plugins/history/ports.js";
import { buildIndex } from "#lib/plugins/search/index.js";
import type { SearchPort } from "./api.js";
export class SearchState implements SearchPort {
  #opened = $state(false);
  #query = $state("");
  #error = $state("");
  #loading = $state(false);
  #indexed = $state(0);
  #find = $state.raw<(query: string) => Row[]>();
  #request?: AbortController;
  #selection?: AbortController;
  #disposed = false;
  readonly #navigation: Pick<HistoryViewportPort, "jump">;
  constructor(navigation: Pick<HistoryViewportPort, "jump">) {
    this.#navigation = navigation;
  }
  get opened() {
    return this.#opened;
  }
  get query() {
    return this.#query;
  }
  get error() {
    return this.#error;
  }
  get loading() {
    return this.#loading;
  }
  get indexed() {
    return this.#indexed;
  }
  get results() {
    return this.#find && this.#query.trim() ? this.#find(this.#query) : [];
  }
  setQuery(query: string) {
    if (!this.#disposed) this.#query = query;
  }
  open() {
    if (this.#disposed || this.#opened) return;
    this.#opened = true;
    this.retry();
  }
  retry() {
    if (this.#disposed || !this.#opened) return;
    this.#request?.abort();
    this.#selection?.abort();
    this.#find = undefined;
    this.#indexed = 0;
    this.#error = "";
    this.#loading = true;
    const request = new AbortController();
    this.#request = request;
    void this.#index(request);
  }
  async #index(request: AbortController) {
    const rows = new Map<number, Row>();
    let before: number | null = null;
    try {
      do {
        const query = new URLSearchParams({ limit: "200" });
        if (before !== null) query.set("before", String(before));
        const page = await http<HistoryPage>(`/api/history?${query}`, { signal: request.signal });
        if (this.#request !== request || request.signal.aborted) return;
        for (const row of page.messages) rows.set(row.i, row);
        this.#find = buildIndex([...rows.values()]);
        this.#indexed = rows.size;
        if (page.nextBefore !== null && before !== null && page.nextBefore >= before)
          throw new Error("历史分页未能继续，请重试。");
        before = page.nextBefore;
      } while (before !== null);
    } catch (error) {
      if (this.#request === request && !request.signal.aborted)
        this.#error = error instanceof Error ? error.message : "无法搜索对话";
    } finally {
      if (this.#request === request && !request.signal.aborted) this.#loading = false;
    }
  }
  close() {
    this.#request?.abort();
    this.#selection?.abort();
    this.#request = undefined;
    this.#selection = undefined;
    this.#opened = false;
    this.#query = "";
    this.#find = undefined;
    this.#indexed = 0;
    this.#loading = false;
    this.#error = "";
  }
  async pick(row: Row) {
    if (this.#disposed || !this.#opened) return;
    const request = this.#request;
    this.#selection?.abort();
    const selection = new AbortController();
    this.#selection = selection;
    this.#error = "";
    try {
      const found = await this.#navigation.jump(row, selection.signal);
      if (this.#disposed || this.#request !== request || selection.signal.aborted) return;
      if (!found) {
        this.#error = "这条消息已不可用，请重试或重新搜索。";
        return;
      }
      this.close();
    } catch (error) {
      if (
        !this.#disposed &&
        this.#request === request &&
        !selection.signal.aborted &&
        !(error instanceof Error && error.name === "AbortError")
      )
        this.#error = error instanceof Error ? error.message : "无法打开消息，请重试。";
    }
  }
  dispose() {
    this.#disposed = true;
    this.close();
  }
}
