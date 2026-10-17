import { createContext } from "svelte";
import type { ViewContribution } from "#lib/app/registries.js";
import type { Ref } from "@earendil-works/chord";
import type { ReadonlyView } from "#lib/app/feature.js";
import type { ModelPreferencesSnapshot } from "#lib/plugins/models/ports.js";
import type { ImagesPort } from "#lib/plugins/images/ports.js";
import type { SpeechView } from "#lib/plugins/speech/api.js";
import type { Conversation } from "#lib/plugins/conversation/api.js";
export type ConversationPort = Pick<
  Ref<typeof Conversation>,
  "view" | "composer" | "send" | "regenerate" | "stop" | "retry" | "reload"
> & {
  readonly actions: readonly (ViewContribution & { key: string })[];
  readonly models: ReadonlyView<ModelPreferencesSnapshot>;
  readonly images: ImagesPort;
  readonly voice: SpeechView;
};
export const [getConversation, setConversation] = createContext<ConversationPort>();
