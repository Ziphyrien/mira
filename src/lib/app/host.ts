import { createHost } from "@earendil-works/chord";
import type { Profile, SpaceState } from "#lib/contracts/index.js";
import { requestSignal } from "#lib/app/cancellation.js";
import { AppLifetime } from "#lib/app/lifecycle.js";
import { ShellState } from "#lib/app/shell.svelte.js";
import { setShell } from "#lib/app/shell-context.js";
import {
  toolbarRegistry,
  composerRegistry,
  composerActionRegistry,
  overlayRegistry,
  settingsSectionRegistry,
} from "#lib/app/registries.js";
import { mainRegistry } from "#lib/app/views.js";
import { History } from "#lib/plugins/history/api.js";
import { historyWeb } from "#lib/plugins/history/web.js";
import { setHistory } from "#lib/plugins/history/context.js";
import { Images } from "#lib/plugins/images/api.js";
import { imagesWeb } from "#lib/plugins/images/web.js";
import { Models } from "#lib/plugins/models/api.js";
import { modelsWeb } from "#lib/plugins/models/web.js";
import { setModels } from "#lib/plugins/models/context.js";
import { Speech } from "#lib/plugins/speech/api.js";
import { speechWeb } from "#lib/plugins/speech/web.js";
import { setSpeech } from "#lib/plugins/speech/context.js";
import { Account } from "#lib/plugins/account/api.js";
import { accountWeb } from "#lib/plugins/account/web.js";
import { setAccount } from "#lib/plugins/account/context.js";
import { Conversation } from "#lib/plugins/conversation/api.js";
import { conversationWeb } from "#lib/plugins/conversation/web.js";
import { setConversation } from "#lib/plugins/conversation/context.js";
import { profileWeb } from "#lib/plugins/profile/web.js";
import { setProfile } from "#lib/plugins/profile/context.js";
import { memoryWeb } from "#lib/plugins/memory/web.js";
import { Memory } from "#lib/plugins/memory/api.js";
import { setMemory } from "#lib/plugins/memory/context.js";
import { Search } from "#lib/plugins/search/api.js";
import { searchWeb } from "#lib/plugins/search/web.js";
import { draftsWeb } from "#lib/plugins/drafts/web.js";
import { setSearch } from "#lib/plugins/search/context.js";

export async function createChatAppHost(
  initial: Extract<SpaceState, { profile: Profile }>,
  onReset: () => void,
) {
  const lifetime = new AppLifetime();
  const shell = new ShellState();
  const host = createHost({ name: "mira.web.app", self: null });
  try {
    await host.load([
      historyWeb(initial),
      imagesWeb(initial.model),
      modelsWeb(initial.model),
      speechWeb(initial.speech, initial.tts),
      accountWeb(initial.profile, () => {
        if (lifetime.alive) onReset();
      }),
      conversationWeb({ initial, lifetime, showChat: shell.showChat }),
      profileWeb,
      memoryWeb,
      searchWeb,
      draftsWeb,
    ]);
    const [history, images, models, speech, account, conversation, memory, search] =
      await Promise.all([
        host.get(History, {}),
        host.get(Images, {}),
        host.get(Models, {}),
        host.get(Speech, {}),
        host.get(Account, {}),
        host.get(Conversation, {}),
        host.get(Memory, {}),
        host.get(Search, {}),
      ]);
    const table = <T extends { order: number }>(entries: ReadonlyMap<string, T>) =>
      Object.freeze(
        [...entries]
          .map(([key, value]) => Object.freeze({ key, ...value }))
          .sort((a, b) => a.order - b.order),
      );
    const views = Object.freeze({
      toolbar: table(host.registry(toolbarRegistry).table()),
      composer: table(host.registry(composerRegistry).table()),
      overlays: table(host.registry(overlayRegistry).table()),
    });
    const composerActions = table(host.registry(composerActionRegistry).table());
    const settingsSections = table(host.registry(settingsSectionRegistry).table());
    const mainViews = table(host.registry(mainRegistry).table());
    let closing: Promise<void> | undefined;
    return {
      views,
      /** Called synchronously by the mounted composition component, once per app instance. */
      provide() {
        setShell({
          get folded() {
            return shell.folded;
          },
          get settings() {
            return shell.settings;
          },
          settingsSections,
          mainViews,
          showChat: shell.showChat,
          toggleMemory: shell.toggleMemory,
          openSettings: shell.openSettings,
          closeSettings: shell.closeSettings,
        });
        setHistory({
          view: history.view,
          navigation: history.navigation,
          prefetch: history.prefetch,
          prepend: history.prepend,
          loadUntil: (id, signal) =>
            host.root((ctx) => history.loadUntil(id, ctx), {
              signal: requestSignal(lifetime.signal, signal),
            }),
          reset: history.reset,
          retry: history.retry,
          activity: conversation.view!,
          models: models.view!,
          images: images.view!,
          voice: speech.view!,
          profile: account.view!,
          send: (text) => conversation.composer!.run(conversation.send(text)),
          regenerate: (row) => conversation.composer!.run(conversation.regenerate(row)),
          speak: (text) => speech.view!.run(speech.play(text)),
          retryReply: () => conversation.composer!.run(conversation.retry(null)),
          reload: () => conversation.composer!.run(conversation.reload(null)),
        });
        setModels({
          view: models.view,
          setThinking: models.setThinking,
          activity: conversation.view!,
        });
        setSpeech({
          activity: conversation.view!,
          history: history.view!,
          images: images.view!,
          view: speech.view,
          play: speech.play,
          stop: speech.stop,
          dictating: speech.dictating,
          preferences: speech.preferences,
          editor: conversation.composer!,
        });
        setProfile({
          get profile() {
            return account.view!.profile;
          },
          apply: (state) => account.apply(state),
        });
        setAccount({
          view: account.view,
          apply: account.apply,
          reset: account.reset,
          flushDraft: account.flushDraft,
          clearDraft: account.clearDraft,
        });
        setConversation({
          actions: composerActions,
          models: models.view!,
          images: { view: images.view, prepare: images.prepare, clear: images.clear },
          voice: speech.view!,
          view: conversation.view,
          composer: conversation.composer,
          send: conversation.send,
          regenerate: conversation.regenerate,
          stop: conversation.stop,
          retry: conversation.retry,
          reload: conversation.reload,
        });
        setMemory(memory.view!);
        setSearch(search.view!);
      },
      restore() {
        conversation.composer!.run(conversation.restore(null));
      },
      dispose() {
        lifetime.dispose();
        return (closing ??= (async () => {
          try {
            await account.flushDraft(null);
          } finally {
            await host.close();
          }
        })());
      },
    };
  } catch (error) {
    lifetime.dispose();
    await host.close();
    throw error;
  }
}
export type ChatAppHost = Awaited<ReturnType<typeof createChatAppHost>>;
