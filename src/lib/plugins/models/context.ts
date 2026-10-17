import { createContext } from "svelte";
import type { Ref } from "@earendil-works/chord";
import type { ReadonlyView } from "#lib/app/feature.js";
import type { ConversationSnapshot } from "#lib/plugins/conversation/ports.js";
import type { Models } from "#lib/plugins/models/api.js";
export type ModelsPort = Pick<Ref<typeof Models>, "view" | "setThinking"> & {
  readonly activity: ReadonlyView<ConversationSnapshot>;
};
export const [getModels, setModels] = createContext<ModelsPort>();
