import { defineFacet, type Ctx, type Facet } from "@earendil-works/chord";
import type { ImageInfo, SpaceState } from "#lib/contracts/index.js";
import { IMAGE_ONLY_TEXT } from "#lib/shared/images.js";
import { requestSignal } from "#lib/app/cancellation.js";
import { http } from "#lib/app/http.js";
import { viewOf } from "#lib/app/feature.js";
import { composerRegistry } from "#lib/app/registries.js";
import type { AppLifetime } from "#lib/app/lifecycle.js";
import { History } from "#lib/plugins/history/api.js";
import { Images } from "#lib/plugins/images/api.js";
import { Models } from "#lib/plugins/models/api.js";
import { Speech } from "#lib/plugins/speech/api.js";
import { Account } from "#lib/plugins/account/api.js";
import { Drafts } from "#lib/plugins/drafts/api.js";
import { ConversationController } from "#lib/plugins/conversation/controller.js";
import type { ConversationSnapshot } from "./ports.js";
import { ComposerState, MAX_DRAFT_LENGTH } from "#lib/plugins/conversation/composer.svelte.js";
import { Conversation } from "#lib/plugins/conversation/api.js";
import Composer from "#lib/plugins/conversation/Composer.svelte";

interface ConversationOptions {
  initial: Pick<Extract<SpaceState, { profile: object }>, "busy" | "generation">;
  lifetime: AppLifetime;
  showChat: () => void;
}

export function conversationWeb({ initial, lifetime, showChat }: ConversationOptions): Facet {
  return {
    name: "mira.web.conversation",
    ...defineFacet(
      (api) =>
        api.serve(
          Conversation,
          (_input, _principal, self) => {
            const history = self.get(History, {});
            const images = self.get(Images, {});
            const models = self.get(Models, {});
            const speech = self.get(Speech, {});
            const account = self.get(Account, {});
            const drafts = self.get(Drafts, {});
            const composer = self.resource("composer", {
              version: 1,
              deps: [drafts],
              open: () => new ComposerState(drafts.buffer!),
              close: (owner) => owner.dispose(),
            });
            const res = {
              controller: self.resource("controller", {
                version: 1,
                deps: [composer, history, images, models, speech, account],
                open: () =>
                  new ConversationController({
                    serverBusy: initial.busy,
                    signal: requestSignal(lifetime.signal, api.signal),
                    onMessages: (rows) =>
                      composer.value.run(
                        api.root(async (ctx) => {
                          if (!lifetime.alive) return;
                          await history.apply(rows, ctx);
                          if (lifetime.alive && !ctx.signal.aborted)
                            await history.navigation!.scrollDown();
                        }),
                      ),
                    onModel: (model) =>
                      composer.value.run(api.root((ctx) => models.setModel(model, ctx))),
                    onDone: (reply) => {
                      const voice = speech.view!;
                      if (voice.enabled && voice.preferences.autoPlay && !voice.dictating)
                        voice.run(api.root((ctx) => speech.play(reply.text, ctx)));
                    },
                  }),
                close: (owner) => owner.dispose(),
              }),
              requests: self.resource("requests", {
                version: 1,
                open: () => new AbortController(),
                close: (controller) => controller.abort(),
              }),
            };
            let temp = -1;
            let submitting = false;
            let restored = false;
            let reloadRevision = 0;
            const blocked = () => {
              const chat = res.controller.value.snapshot;
              const photo = images.view!.snapshot;
              return (
                !lifetime.alive ||
                !chat.matches("idle") ||
                chat.serverBusy ||
                speech.view!.dictating ||
                photo.preparing ||
                photo.uploading ||
                !models.view!.snapshot.model
              );
            };
            const prepare = async (ctx: Ctx) => {
              showChat();
              await history.reset(null, ctx);
              if (!lifetime.alive || ctx.signal.aborted) return;
              await speech.stop(null, ctx);
              if (speech.view!.enabled && speech.view!.preferences.autoPlay)
                await speech.unlock(null, ctx);
            };
            const exclusive = async (work: () => Promise<void>) => {
              if (submitting || blocked()) return;
              submitting = true;
              try {
                await work();
              } finally {
                submitting = false;
              }
            };
            self.register(composerRegistry, { conversation: { order: 10, component: Composer } });
            return {
              composer: self.expose(composer),
              view: viewOf<ConversationSnapshot>(() => res.controller.value),
              send: (text, ctx) =>
                exclusive(async () => {
                  const revision = composer.value.revision;
                  const input = text.trim();
                  const photo = images.view!.snapshot;
                  if (text.length > MAX_DRAFT_LENGTH || (!input && !photo.blob)) return;
                  await drafts.flush(null, ctx);
                  if (blocked() || ctx.signal.aborted) return;
                  let image: ImageInfo | null = null;
                  if (photo.blob) {
                    image = await images.upload(null, ctx);
                    if (!image || blocked() || images.view!.snapshot.blob !== photo.blob) return;
                  }
                  await prepare(ctx);
                  if (blocked() || ctx.signal.aborted) return;
                  composer.value.clearError();
                  const choice = models.view!.snapshot;
                  if (!choice.model) return;
                  await history.append(
                    {
                      i: temp--,
                      kind: "user",
                      text: input || IMAGE_ONLY_TEXT,
                      ...(image ? { image } : {}),
                      at: Date.now(),
                    },
                    ctx,
                  );
                  if (!lifetime.alive || ctx.signal.aborted) return;
                  res.controller.value.send({
                    text: input,
                    ...(image ? { image: image.id } : {}),
                    thinking: choice.thinking,
                    model: choice.model,
                  });
                  composer.value.clearSent(text, revision);
                  if (images.view!.snapshot.blob === photo.blob) await images.clear(null, ctx);
                  await drafts.flush(null, ctx);
                  if (lifetime.alive && !ctx.signal.aborted)
                    await history.navigation!.scrollDown(true);
                }),
              regenerate: (row, ctx) =>
                exclusive(async () => {
                  if (row.i < 0) return;
                  await prepare(ctx);
                  if (blocked() || ctx.signal.aborted) return;
                  const old = history.view!.snapshot;
                  const userId = row.kind === "user" ? row.i : row.replyTo;
                  if (userId !== undefined)
                    await history.replace(
                      {
                        rows: old.rows.filter((item) => item.i <= userId),
                        nextBefore: old.nextBefore,
                      },
                      ctx,
                    );
                  if (!lifetime.alive || ctx.signal.aborted) return;
                  const choice = models.view!.snapshot;
                  if (!choice.model) return;
                  res.controller.value.regenerate({
                    prompt:
                      row.kind === "user"
                        ? { kind: "question", userId: row.i }
                        : { kind: "reply", replyId: row.i },
                    thinking: choice.thinking,
                    model: choice.model,
                  });
                  await history.navigation!.scrollDown(true);
                }),
              stop: (_input, ctx) =>
                res.controller.value.stop(requestSignal(lifetime.signal, ctx.signal)),
              retry: () => res.controller.value.retry(),
              reload: async (_input, ctx) => {
                const revision = ++reloadRevision;
                const signal = AbortSignal.any([
                  ctx.signal,
                  lifetime.signal,
                  res.requests.value.signal,
                ]);
                const state = await http<SpaceState>("/api/me", {
                  signal,
                });
                if (signal.aborted || revision !== reloadRevision) return;
                await account.apply(state, ctx);
                if (!state.profile || signal.aborted || revision !== reloadRevision) return;
                await history.replace({ rows: state.messages, nextBefore: state.nextBefore }, ctx);
                if (signal.aborted || revision !== reloadRevision) return;
                restored = true;
                res.controller.value.reconcile(state);
              },
              restore: () => {
                if (restored || !lifetime.alive) return;
                restored = true;
                res.controller.value.reconcile(initial);
              },
            };
          },
          { lifetime: "host" },
        ),
      { uses: [History, Images, Models, Speech, Account, Drafts] },
    ),
  };
}
