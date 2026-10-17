import { local, opaque } from "@earendil-works/chord";
import { Type } from "typebox";
import type { MemoryTree, MemoryTreeNode } from "#lib/contracts/index.js";

export interface MemoryPort {
  readonly root: MemoryTree | undefined;
  readonly loading: boolean;
  readonly error: string;
  readonly opened: Readonly<Record<string, boolean>>;
  readonly pending: Readonly<Record<string, boolean>>;
  readonly failures: Readonly<Record<string, string>>;
  readonly cache: Readonly<Record<string, MemoryTree>>;
  prefetch(): Promise<void>;
  refresh(): Promise<void>;
  prefetchNode(node: MemoryTreeNode): void;
  load(node: MemoryTreeNode): Promise<void>;
  toggle(node: MemoryTreeNode): void;
  collapse(): void;
}

export const Memory = local("mira.web.memory", {
  version: 1,
  input: Type.Object({}),
  members: { view: opaque<MemoryPort>("mira.memory-view@1") },
});
