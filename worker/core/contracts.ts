import { defineRegistry } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";

/** Type carrier for explicitly host-local native values; never a wire or observable-state schema. */
export function localValue<T>(name: string) {
  return Type.Unsafe<T>(Type.Unknown({ description: name }));
}
export const Alarms = defineRegistry<() => Promise<void>>("mira.alarms", { conflict: "error" });
