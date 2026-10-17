import { defineFacet, type Facet } from "@earendil-works/chord";
import type { Sql } from "../../core/storage";
import { AiSettings } from "./settings";
import { ModelSettings } from "./api";
export function modelSettingsFacet(sql: Sql): Facet {
  return {
    name: "mira.models.settings",
    ...defineFacet((api) =>
      api.serve(ModelSettings, (_input, _principal, self) => {
        const settingsResource = self.resource("settings", {
          version: 1,
          open: () => new AiSettings(sql),
        });
        return {
          configuration: () => settingsResource.value.read(),
          admin: () => settingsResource.value.admin(),
          chatModel: () => settingsResource.value.chatModel(),
          save: (input) => settingsResource.value.save(input),
        };
      }),
    ),
  };
}
