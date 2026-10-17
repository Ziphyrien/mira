import type { ImageInfo } from "./images.js";
import type { SearchActivity } from "./search.js";

export type MemoryTreeNode = { id: number; n: number; text: string; ready: boolean };
export type MemoryTreePage = {
  total: number;
  nodes: MemoryTreeNode[];
  original?: { kind: string; text: string; at: number; searches?: SearchActivity[]; image?: ImageInfo };
};
export type MemoryTree = MemoryTreePage & { epoch: string };

/** Shared response fragment; not an additional public barrel export. */
export type Stats = { messages: number; summaries: number; viewLines: number; pending: number };
