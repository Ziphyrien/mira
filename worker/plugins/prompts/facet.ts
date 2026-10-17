import { defineFacet, type Facet } from "@earendil-works/chord";
import { KeyValue } from "../../core/kv";
import type { SpaceScope } from "../../core/storage";
import { ProfileData } from "../profile/api";
import { ConversationStore } from "../conversation/api";
import { PromptPlans } from "./api";
import { composePrompt, sameModel } from "./compose";

export function promptsFacet(scope: SpaceScope): Facet {
  return {
    name: "mira.prompts",
    ...defineFacet(
      (api) => {
        api.serve(PromptPlans, (_input, _principal, self) => {
          const profile = self.get(ProfileData, {}),
            journal = self.get(ConversationStore, {});
          const values = new KeyValue(scope.storage.sql);
          return {
            create: async (input, ctx) => {
              const shared = sameModel(input.models.chat, input.models.memory);
              const active = journal.store!.active();
              if (
                input.purpose === "compaction" &&
                shared &&
                active?.prompt?.mode === "shared" &&
                sameModel(active.prompt.model, input.models.memory)
              )
                return active.prompt;
              const previous = active ?? journal.store!.last();
              const thinking =
                input.thinking ??
                (input.purpose === "compaction" &&
                shared &&
                sameModel(previous?.input.model, input.models.memory)
                  ? previous?.input.thinking
                  : undefined);
              const p =
                shared || input.purpose === "turn" ? await profile.get(null, ctx) : undefined;
              const plan = composePrompt({ ...input, thinking }, p ?? undefined);
              const lane = shared ? "shared" : input.purpose;
              const key = `prompt-session:${JSON.stringify([lane, plan.model.provider, plan.model.modelId])}`;
              let sessionId = values.get(key);
              if (!sessionId) {
                sessionId = crypto.randomUUID();
                values.set(key, sessionId);
              }
              return { ...plan, sessionId };
            },
          };
        });
      },
      { uses: [ProfileData, ConversationStore] },
    ),
  };
}
