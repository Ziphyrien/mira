import { defineFacet, type Facet } from "@earendil-works/chord";
import { adminSectionRegistry } from "#lib/app/registries.js";
import ModelSettings from "#lib/plugins/models/ModelSettings.svelte";

import { ModelsAdmin } from "#lib/plugins/models/admin-api.js";

export const modelAdminFacet: Facet = {
  name: "mira.web.models.admin",
  ...defineFacet((api) =>
    api.serve(
      ModelsAdmin,
      (_input, _principal, self) => {
        self.register(adminSectionRegistry, {
          modelSettings: { order: 10, component: ModelSettings },
        });
        return {};
      },
      { lifetime: "host" },
    ),
  ),
};
