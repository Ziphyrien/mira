import type { ChatInput, SearchActivity } from "#lib/contracts/index.js";

export type ChatContext = {
  request: ChatInput | null;
  text: string;
  thinkingText: string;
  searches: SearchActivity[];
  stopped: boolean;
  phase: "thinking" | "recall";
  error: string;
};

export type ConversationSnapshot = {
  readonly context: Readonly<ChatContext>;
  readonly matches: (state: "idle" | "streaming" | "failed") => boolean;
  readonly serverBusy: boolean;
  readonly stopping: boolean;
  readonly stopError: string | null;
};

export interface DictationTarget {
  beginDictation(): boolean;
  previewDictation(text: string): string;
  finishDictation(commit: boolean): void;
}

export interface ComposerPort extends DictationTarget {
  readonly draft: string;
  readonly error: string;
  setDraft(text: string): void;
  readonly selection: { start: number; end: number };
  readonly focusRequest: number;
  readonly composing: boolean;
  select(start: number, end: number): void;
  clearSent(text: string): void;
  clearError(): void;
  run(work: Promise<unknown>): void;
}
