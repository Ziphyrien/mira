import { defineRegistry } from "@earendil-works/chord";
import type { Component } from "svelte";
export type ViewContribution = { order: number; component: Component<Record<string, never>> };
export const toolbarRegistry = defineRegistry<ViewContribution>("mira.web.toolbar", {
  conflict: "error",
});
export const composerRegistry = defineRegistry<ViewContribution>("mira.web.composer", {
  conflict: "error",
});
export const composerActionRegistry = defineRegistry<ViewContribution>("mira.web.composer-actions", {
  conflict: "error",
});
export const overlayRegistry = defineRegistry<ViewContribution>("mira.web.overlays", {
  conflict: "error",
});
export const settingsSectionRegistry = defineRegistry<ViewContribution>("mira.web.settings", {
  conflict: "error",
});
export const adminSectionRegistry = defineRegistry<ViewContribution>("mira.web.admin", {
  conflict: "error",
});
