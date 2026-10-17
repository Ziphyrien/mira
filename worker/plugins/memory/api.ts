export { MEMORY_TOOLS } from "./tools";
export { restoreMemoryBackup } from "./backup";
import { local, method, opaque } from "@earendil-works/chord";
import { Type, type ImageContent } from "@earendil-works/pi-ai";
import type { MemoryTreePage } from "../../../src/lib/contracts";
import { localValue } from "../../core/contracts";
import type { MemoryPort, MemoryLine } from "./ports";
export const MemoryStore = local("mira.memory.store", {
  version: 1,
  input: Type.Object({}),
  members: { store: opaque<MemoryPort>("mira.sqlite-memory@1") },
});
export const MemoryQueries = local("mira.memory.queries", {
  version: 1,
  input: Type.Object({}),
  members: {
    zoom: method(
      Type.Object({
        id: Type.Integer(),
        n: Type.Optional(Type.Integer()),
        at: Type.Optional(Type.Integer()),
        page: Type.Optional(Type.Integer()),
      }),
      localValue<{ text: string; image?: ImageContent }>("mira.memory-zoom@2"),
    ),
    date: method(Type.Integer(), Type.String()),
    tree: method(
      Type.Object({ id: Type.Optional(Type.Integer()), n: Type.Optional(Type.Integer()) }),
      localValue<MemoryTreePage | null>("mira.memory-tree-page@1"),
    ),
    lines: method(Type.Null(), localValue<MemoryLine[]>("mira.memory-lines@1")),
    export: method(Type.Null(), localValue<ReadableStream<Uint8Array>>("mira.memory-export@1")),
  },
});

export const MemoryExtension = local("mira.memory.extension", {
  version: 1,
  input: Type.Object({}),
});
