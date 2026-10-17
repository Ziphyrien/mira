import { local, method } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import type { HistoryPage, MemoryTree } from "../../../src/lib/contracts";
import { localValue } from "../../core/contracts";
export { HistoryProjection } from "./projection";

export const HistoryQueries = local("mira.history.queries", {
  version: 1,
  input: Type.Object({}),
  members: {
    page: method(
      Type.Object({ before: Type.Optional(Type.Integer()), limit: Type.Optional(Type.Integer()) }),
      localValue<HistoryPage>("mira.history-page@1"),
    ),
    tree: method(
      Type.Object({ id: Type.Optional(Type.Integer()), n: Type.Optional(Type.Integer()) }),
      localValue<MemoryTree | null>("mira.memory-tree@1"),
    ),
  },
});
