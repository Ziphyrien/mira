import { defineFacet, type Facet } from "@earendil-works/chord";
import { settingsSectionRegistry } from "#lib/app/registries.js";
import ProfileSettings from "#lib/plugins/profile/ProfileSettings.svelte";
import { ProfileSettingsFeature } from "#lib/plugins/profile/api.js";
export const profileWeb: Facet = {
  name: "mira.web.profile",
  ...defineFacet((api) =>
    api.serve(
      ProfileSettingsFeature,
      (_input, _principal, self) => {
        self.register(settingsSectionRegistry, {
          profile: { order: 10, component: ProfileSettings },
        });
        return {};
      },
      { lifetime: "host" },
    ),
  ),
};
