import type { Row } from "#lib/contracts/index.js";
import type { HistoryViewportPort, HistoryNavigationPort } from "./ports.js";
export class HistoryNavigation implements HistoryNavigationPort {
  #viewport?: HistoryViewportPort;
  #disposed = false;
  attach(viewport: HistoryViewportPort) {
    if (this.#disposed) return () => {};
    this.#viewport = viewport;
    return () => {
      if (this.#viewport === viewport) this.#viewport = undefined;
    };
  }
  async scrollDown(force = false) {
    await this.#viewport?.scrollDown(force);
  }
  async jump(row: Row, signal?: AbortSignal) {
    signal?.throwIfAborted();
    return (await this.#viewport?.jump(row, signal)) ?? false;
  }
  dispose() {
    this.#disposed = true;
    this.#viewport = undefined;
  }
}
