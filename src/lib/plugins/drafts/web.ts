import { defineFacet, type Facet } from "@earendil-works/chord";
import { Drafts } from "./api.js";
import { DurableDraft } from "./store.js";

export const draftsWeb: Facet = {
  name: "mira.web.drafts",
  ...defineFacet((api) =>
    api.serve(
      Drafts,
      (_input, _principal, self) => {
        const draft = self.resource("draft", {
          version: 1,
          open: () => new DurableDraft(),
          close: (owner) => owner.dispose(),
        });
        return {
          buffer: self.expose(draft),
          flush: () => draft.value.flush(),
          clear: () => draft.value.clear(),
        };
      },
      { lifetime: "host" },
    ),
  ),
};
