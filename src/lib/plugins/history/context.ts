import { createContext } from "svelte";
import type { Ref } from "@earendil-works/chord";
import type { ReadonlyView } from "#lib/app/feature.js";
import type { Row } from "#lib/contracts/index.js";
import type { ConversationSnapshot } from "#lib/plugins/conversation/ports.js";
import type { ModelPreferencesSnapshot } from "#lib/plugins/models/ports.js";
import type { ImageDraftSnapshot } from "#lib/plugins/images/ports.js";
import type { SpeechView } from "#lib/plugins/speech/api.js";
import type { AccountView } from "#lib/plugins/account/api.js";
import type { History } from "#lib/plugins/history/api.js";
export type HistoryPort = Pick<
  Ref<typeof History>,
  "view" | "navigation" | "prefetch" | "prepend" | "reset" | "retry"
> & {
  readonly activity: ReadonlyView<ConversationSnapshot>;
  readonly models: ReadonlyView<ModelPreferencesSnapshot>;
  readonly images: ReadonlyView<ImageDraftSnapshot>;
  readonly voice: SpeechView;
  readonly profile: AccountView;
  loadUntil(id: number, signal?: AbortSignal): Promise<boolean>;
  send(text: string): void;
  regenerate(row: Row): void;
  speak(text: string): void;
  retryReply(): void;
  reload(): void;
};
export const [getHistory, setHistory] = createContext<HistoryPort>();
