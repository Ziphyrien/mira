import { defineFacet, type Facet } from "@earendil-works/chord";
import { defineExtension, GenerationTask, hook } from "@earendil-works/pi-durable";
import { Extensions } from "../generation/api";
import { ConversationStore } from "../conversation/api";
import { PromptExtension } from "./api";

/** One persisted prompt snapshot owns every request in a turn, including tool rounds and retries. */
export const promptExtensionFacet: Facet = {
  name: "mira.prompts.extension",
  ...defineFacet(
    (api) =>
      api.serve(
        PromptExtension,
        (_input, _principal, self) => {
          const journal = self.get(ConversationStore, {});
          self.register(Extensions, {
            prompts: {
              order: 10,
              extension: defineExtension({
                name: "mira.prompts",
                hooks: [
                  hook(GenerationTask, {
                    beforeRequest: (request) => {
                      const plan = journal.store!.active()?.prompt;
                      if (!plan) throw new Error("Turn prompt was not prepared");
                      return {
                        messages: [
                          {
                            role: "system" as const,
                            content: plan.system,
                            toolsAdded: plan.tools,
                            timestamp: 0,
                          },
                          ...request.messages.filter((m) => m.role !== "system"),
                        ],
                      };
                    },
                  }),
                ],
              }),
            },
          });
          return {};
        },
        { lifetime: "host" },
      ),
    { uses: [ConversationStore] },
  ),
};
