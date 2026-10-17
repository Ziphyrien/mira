import { createHost } from "@earendil-works/chord";
import { Alarms } from "./contracts";
import type { SpaceScope } from "./storage";
import { profileFacet } from "../plugins/profile/facet";
import { SpeechSettings } from "../plugins/profile/api";
import { promptsFacet } from "../plugins/prompts/facet";
import { promptExtensionFacet } from "../plugins/prompts/extension";
import { modelsFacet } from "../plugins/models/facet";
import { imagesFacet } from "../plugins/images/facet";
import { ImageCommands } from "../plugins/images/api";
import { memoryFacet } from "../plugins/memory/facet";
import { MemoryQueries } from "../plugins/memory/api";
import { memoryExtensionFacet } from "../plugins/memory/extension";
import { persistenceFacet } from "../plugins/conversation/persistence-facet";
import { generationFacet } from "../plugins/generation/facet";
import { conversationFacet } from "../plugins/conversation/facet";
import { ConversationCommands } from "../plugins/conversation/api";
import { historyFacet } from "../plugins/history/facet";
import { HistoryQueries } from "../plugins/history/api";
import { accountFacet } from "../plugins/account/facet";
import { AccountCommands } from "../plugins/account/api";
import { searchFacet } from "../plugins/search/facet";
import { speechFacet } from "../plugins/speech/facet";
import { SpeechSynthesis } from "../plugins/speech/api";
export async function openSpace(scope: SpaceScope, failed: (closing: Promise<void>) => void) {
  const host = createHost({
    name: "mira.space",
    self: null,
    onError: (error) => {
      if (scope.alive) console.error("space.host", error);
    },
  });
  let closing: Promise<void> | undefined;
  const close = () => {
    scope.retire();
    return (closing ??= host.close().finally(() => scope.drain()));
  };
  const fatal = () => {
    const work = close();
    failed(work);
    scope.platform.waitUntil(work.catch((error: unknown) => console.error("space.close", error)));
  };
  try {
    await host.load([
      profileFacet(scope),
      speechFacet(scope),
      modelsFacet(scope),
      imagesFacet(scope),
      persistenceFacet(scope),
      memoryFacet(scope),
      historyFacet(),
      promptsFacet(scope),
      promptExtensionFacet,
      memoryExtensionFacet,
      searchFacet(scope),
      generationFacet(scope, fatal),
      conversationFacet(scope),
      accountFacet(scope),
    ]);
    const [account, conversation, history, memory, images, speech, synthesis] = await Promise.all([
      host.get(AccountCommands, {}),
      host.get(ConversationCommands, {}),
      host.get(HistoryQueries, {}),
      host.get(MemoryQueries, {}),
      host.get(ImageCommands, {}),
      host.get(SpeechSettings, {}),
      host.get(SpeechSynthesis, {}),
    ]);
    scope.assert();
    return {
      account,
      conversation,
      history,
      memory,
      images,
      speech,
      synthesis,
      alarm: async () => {
        scope.alarmDelivered();
        for (const handler of host.registry(Alarms).table().values()) await handler();
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
export type SpaceRuntime = Awaited<ReturnType<typeof openSpace>>;
