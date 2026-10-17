import { defineFacet, type Facet } from "@earendil-works/chord";
import type { SpaceScope } from "../../core/storage";
import { ImageStore } from "../images/api";
import { ConversationStore } from "./api";
import { ConversationPersistence } from "./persistence";
export function persistenceFacet(scope: SpaceScope): Facet {
  return {
    name: "mira.conversation.persistence",
    ...defineFacet(
      (api) =>
        api.serve(ConversationStore, (_input, _principal, self) => {
          const images = self.get(ImageStore, {});
          const persistenceResource = self.resource("persistence", {
            version: 1,
            deps: [images],
            open: () =>
              new ConversationPersistence(scope.storage, images.store!, () => scope.alive),
          });
          return { store: self.expose(persistenceResource) };
        }),
      { uses: [ImageStore] },
    ),
  };
}
