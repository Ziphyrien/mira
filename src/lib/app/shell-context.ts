import { createContext } from "svelte";
import type { ViewContribution } from "#lib/app/registries.js";
type ViewEntry = ViewContribution & { key: string };
export interface ShellPort {
  readonly folded: boolean;
  readonly settings: boolean;
  readonly settingsSections: readonly ViewEntry[];
  readonly mainViews: readonly ViewEntry[];
  showChat(): void;
  toggleMemory(): void;
  openSettings(): void;
  closeSettings(): void;
}
export const [getShell, setShell] = createContext<ShellPort>();
