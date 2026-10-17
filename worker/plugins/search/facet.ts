import { defineFacet, type Facet } from "@earendil-works/chord";
import { defineExtension } from "@earendil-works/pi-durable";
import { Extensions } from "../generation/api";
import type { SpaceScope } from "../../core/storage";
import { ConversationStore } from "../conversation/api";
import { tavilySearchTool } from "./tool";
import { SearchExtension } from "./api";
export function searchFacet(scope: SpaceScope): Facet {
  return {
    name: "mira.search",
    ...defineFacet(
      (api) =>
        api.serve(
          SearchExtension,
          (_input, _principal, self) => {
            const journal = self.get(ConversationStore, {});
            self.register(Extensions, {
              search: {
                order: 30,
                extension: defineExtension({
                  name: "mira.search",
                  tools: [
                    tavilySearchTool(
                      async () => {
                        const config = await scope.directory.aiConfiguration();
                        scope.assert();
                        return config.keys.tavily;
                      },
                      (activity) => journal.store!.report(activity),
                    ),
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
}
