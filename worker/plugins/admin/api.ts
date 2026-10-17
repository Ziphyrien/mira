import { local, method } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import type { SpaceSummary } from "../../../src/lib/contracts";
import { localValue } from "../../core/contracts";
export { UsageProjection } from "./usage";
export { UsageLedger } from "./usage-store";

export type SpaceList = { items: SpaceSummary[]; total: number; messages: number; cost: number };
export const IndexCommands = local("mira.directory.index", {
  version: 1,
  input: Type.Object({}),
  members: {
    touch: method(
      localValue<Omit<SpaceSummary, "seen">>("mira.space-summary-input@1"),
      Type.Void(),
    ),
    has: method(Type.String(), Type.Boolean()),
    mint: method(Type.String(), Type.Boolean()),
    list: method(
      Type.Object({ query: Type.String(), offset: Type.Integer() }),
      localValue<SpaceList>("mira.space-list@1"),
    ),
    remove: method(Type.String(), Type.Void()),
  },
});
