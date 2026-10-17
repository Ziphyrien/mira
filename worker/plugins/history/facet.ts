import { defineFacet, type Facet } from "@earendil-works/chord";
import { ImageStore } from "../images/api";
import { MemoryStore } from "../memory/api";
import { ConversationStore } from "../conversation/api";
import { HistoryProjection } from "./projection";
import { HistoryQueries } from "./api";
export function historyFacet(): Facet {
  return {
    name: "mira.history",
    ...defineFacet(
      (api) =>
        api.serve(HistoryQueries, (_input, _principal, self) => {
          const memory = self.get(MemoryStore, {}),
            images = self.get(ImageStore, {}),
            replies = self.get(ConversationStore, {});
          const historyResource = self.resource("history", {
            version: 1,
            deps: [memory, images, replies],
            open: () => new HistoryProjection(memory.store!, images.store!, replies.store!),
          });
          return {
            page: ({ before, limit }) => historyResource.value.page(before, limit ?? 80),
            tree: ({ id, n }) => historyResource.value.tree(id, n),
          };
        }),
      { uses: [MemoryStore, ImageStore, ConversationStore] },
    ),
  };
}
