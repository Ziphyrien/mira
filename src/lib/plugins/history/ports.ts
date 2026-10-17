import type { HistoryPage, Row } from "#lib/contracts/index.js";

export type HistorySnapshot = {
  readonly rows: readonly Row[];
  readonly nextBefore: number | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly prefetched: HistoryPage | null;
  readonly revision: number;
};

/** Scroll anchor metadata returned when earlier messages are prepended. */
export type PrependResult = {
  readonly prepended: boolean;
  readonly count: number;
  readonly revision: number;
  readonly previousFirstId: number | null;
};

export interface HistoryViewportPort {
  scrollDown(force?: boolean): Promise<void>;
  jump(row: Row, signal?: AbortSignal): Promise<boolean>;
}

export interface HistoryNavigationPort extends HistoryViewportPort {
  attach(viewport: HistoryViewportPort): () => void;
}
