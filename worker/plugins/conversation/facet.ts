import { defineFacet, type Facet } from "@earendil-works/chord";
import { ChatInput } from "../../../src/lib/contracts";
import { StreamDelivery } from "./delivery";
import { Alarms } from "../../core/contracts";
import type { SpaceScope } from "../../core/storage";
import { ProfileData } from "../profile/api";
import { PromptPlans } from "../prompts/api";
import { SessionModels } from "../models/api";
import { MemoryStore } from "../memory/api";
import { ImageStore } from "../images/api";
import { Generation } from "../generation/api";
import { HistoryProjection } from "../history/api";
import { UsageProjection } from "../admin/api";
import { AccountIdentity } from "../account/api";
import { ConversationCommands, ConversationStore } from "./api";
import { Transcript } from "./transcript";
import { OperationCoordinator } from "./coordinator";
export function conversationFacet(scope: SpaceScope): Facet {
  const identity = new AccountIdentity(scope.storage.sql);
  return {
    name: "mira.conversation",
    ...defineFacet(
      (api) =>
        api.serve(
          ConversationCommands,
          (_input, _principal, self) => {
            const profile = self.get(ProfileData, {}),
              models = self.get(SessionModels, {}),
              prompts = self.get(PromptPlans, {}),
              memory = self.get(MemoryStore, {}),
              images = self.get(ImageStore, {}),
              generation = self.get(Generation, {}),
              journal = self.get(ConversationStore, {});
            const executionResource = self.resource("execution", {
              version: 1,
              deps: [profile, models, prompts, memory, images, generation, journal],
              open: async () => {
                const engine = generation.engine!,
                  store = memory.store!,
                  persistence = journal.store!;
                const getProfile = () => api.root((ctx) => profile.get(null, ctx));
                const history = new HistoryProjection(store, images.store!, persistence);
                const transcript = new Transcript(scope, store, engine.transcript, persistence);
                await transcript.attach();
                const coordinator = new OperationCoordinator(
                  scope,
                  engine.turn,
                  store,
                  models.registry!.chat,
                  { create: (request) => api.root((ctx) => prompts.create(request, ctx)) },
                  getProfile,
                  images.store!,
                  persistence,
                  history,
                  transcript,
                  new UsageProjection(scope, engine.usage, store, getProfile, identity),
                  identity,
                );
                try {
                  await coordinator.resume();
                  store.pump();
                  return coordinator;
                } catch (error) {
                  await coordinator.close();
                  throw error;
                }
              },
              close: (coordinator) => coordinator.close(),
            });
            self.register(Alarms, {
              conversation: async () => {
                const coordinator = executionResource.value;
                await coordinator.resume();
                await coordinator.alarm();
              },
            });
            return {
              prepareImport: () => executionResource.value.prepareImport(),
              chat: ({ uid, input }) => {
                const parsed = ChatInput.parse(input);
                identity.identify(uid);
                const delivery = new StreamDelivery(scope.signal);
                scope.background(
                  executionResource.value
                    .run(parsed, delivery.send, delivery.signal)
                    .catch((error: unknown) => {
                      return delivery.send({
                        type: "error",
                        message:
                          error instanceof Error && error.name === "ModelSelectionError"
                            ? error.message
                            : "这次没有顺利回复，请再试一次。",
                      });
                    })
                    .finally(() => delivery.close()),
                  "conversation.turn",
                );
                return delivery.readable;
              },
              stop: (requestId) => executionResource.value.stop(requestId),
              busy: () => executionResource.value.busy(),
            };
          },
          { lifetime: "host" },
        ),
      {
        uses: [
          ProfileData,
          SessionModels,
          PromptPlans,
          MemoryStore,
          ImageStore,
          Generation,
          ConversationStore,
        ],
      },
    ),
  };
}
