import { defineRegistry } from "@earendil-works/chord";
import type { ViewContribution } from "#lib/app/registries.js";
export const mainRegistry = defineRegistry<ViewContribution>("mira.web.main", {
  conflict: "error",
});
