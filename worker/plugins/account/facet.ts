import { defineFacet, type Facet } from "@earendil-works/chord";
import { ProfileInput } from "../../../src/lib/contracts";
import type { SpaceScope } from "../../core/storage";
import { ConversationCommands, ConversationStore } from "../conversation/api";
import { HistoryQueries } from "../history/api";
import { MemoryStore } from "../memory/api";
import { ProfileData, ProfilePersistence, SpeechSettings, profileNote } from "../profile/api";
import { Generation } from "../generation/api";
import { UsageProjection } from "../admin/api";
import { AccountCommands } from "./api";
import { AccountIdentity } from "./identity";
export function accountFacet(scope: SpaceScope): Facet {
  const identity = new AccountIdentity(scope.storage.sql);
  return {
    name: "mira.account",
    ...defineFacet(
      (api) =>
        api.serve(AccountCommands, (_input, _principal, self) => {
          const conversation = self.get(ConversationCommands, {}),
            profile = self.get(ProfileData, {}),
            profilePersistence = self.get(ProfilePersistence, {}),
            speech = self.get(SpeechSettings, {}),
            history = self.get(HistoryQueries, {}),
            memory = self.get(MemoryStore, {}),
            journal = self.get(ConversationStore, {}),
            generation = self.get(Generation, {});
          const usage = () =>
            new UsageProjection(
              scope,
              generation.engine!.usage,
              memory.store!,
              () => api.root((ctx) => profile.get(null, ctx)),
              identity,
            );
          const snapshot = (uid: string) =>
            api.root(async (ctx) => {
              identity.identify(uid);
              const kernelBusy = await conversation.busy(null, ctx);
              const model = await scope.directory.chatModel(),
                tts = Boolean((await scope.directory.aiConfiguration()).keys.mimo);
              const operation = journal.store!.last();
              const pending =
                operation && (operation.status === "running" || operation.status === "failed")
                  ? {
                      input: operation.input,
                      status: operation.status,
                      ...(operation.error ? { error: operation.error } : {}),
                    }
                  : null;
              const p = await profile.get(null, ctx),
                preferences = await speech.get(null, ctx),
                page = await history.page({ limit: 80 }, ctx),
                stats = memory.store!.stats();
              const common = {
                model,
                tts,
                ...page,
                busy: operation?.status === "running" || kernelBusy,
                generation: pending,
                stats,
              };
              return p
                ? { ...common, profile: p, speech: preferences! }
                : { ...common, profile: null, speech: null };
            });
          return {
            state: snapshot,
            configure: async ({ uid, input }, ctx) => {
              const p = ProfileInput.parse(input);
              identity.initialize(uid);
              const note = profileNote(p, await profile.get(null, ctx));
              if (note !== undefined) {
                memory.store!.append("note", note, () => profilePersistence.store!.set(p));
                await usage().touch();
              }
              return snapshot(uid);
            },
            inspect: async (_input, ctx) => ({
              profile: await profile.get(null, ctx),
              stats: memory.store!.stats(),
              messages: (await history.page({ limit: 300 }, ctx)).messages,
              view: memory.store!.render(),
              cost: await usage().cost(),
            }),
          };
        }),
      {
        uses: [
          ConversationCommands,
          ProfileData,
          ProfilePersistence,
          SpeechSettings,
          HistoryQueries,
          MemoryStore,
          ConversationStore,
          Generation,
        ],
      },
    ),
  };
}
