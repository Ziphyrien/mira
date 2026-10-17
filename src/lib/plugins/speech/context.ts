import { createContext } from "svelte";
import type { DictationTarget } from "#lib/plugins/conversation/ports.js";
import type { Ref } from "@earendil-works/chord";
import type { ReadonlyView } from "#lib/app/feature.js";
import type { ConversationSnapshot } from "#lib/plugins/conversation/ports.js";
import type { HistorySnapshot } from "#lib/plugins/history/ports.js";
import type { ImageDraftSnapshot } from "#lib/plugins/images/ports.js";
import type { Speech } from "#lib/plugins/speech/api.js";
export type SpeechPort = Pick<
  Ref<typeof Speech>,
  "view" | "play" | "stop" | "dictating" | "preferences"
> & {
  readonly activity: ReadonlyView<ConversationSnapshot>;
  readonly history: ReadonlyView<HistorySnapshot>;
  readonly images: ReadonlyView<ImageDraftSnapshot>;
  readonly editor: DictationTarget;
};
export const [getSpeech, setSpeech] = createContext<SpeechPort>();
