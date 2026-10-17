import { defineFacet, type Facet } from "@earendil-works/chord";
import type { AiModelInfo } from "#lib/contracts/index.js";
import { viewOf } from "#lib/app/feature.js";

import { ImageDraftController } from "#lib/plugins/images/draft.js";
import type { ImageDraftSnapshot } from "./ports.js";
import { Images } from "#lib/plugins/images/api.js";
import { Drafts } from "#lib/plugins/drafts/api.js";
export function imagesWeb(model: AiModelInfo | null): Facet {
  return {
    name: "mira.web.images",
    ...defineFacet(
      (api) =>
        api.serve(
          Images,
          (_input, _principal, self) => {
            const drafts = self.get(Drafts, {});
            const draft = self.resource("images", {
              version: 1,
              deps: [drafts],
              open: () => new ImageDraftController({ model, drafts: drafts.buffer! }),
              close: (owner) => owner.dispose(),
            });
            return {
              view: viewOf<ImageDraftSnapshot>(() => draft.value),
              pick: (blob) => draft.value.pick(blob),
              prepare: (file, ctx) => draft.value.prepare(file, ctx.signal),
              clear: () => draft.value.clear(),
              clearError: () => draft.value.clearError(),
              upload: (_input, ctx) => draft.value.upload(ctx.signal),
              setModel: (model) => draft.value.setModel(model),
            };
          },
          { lifetime: "host" },
        ),
      { uses: [Drafts] },
    ),
  };
}
