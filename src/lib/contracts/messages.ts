import type { ImageInfo } from "./images.js";
import type { SearchActivity } from "./search.js";

export type Row = {
  i: number;
  kind: "user" | "mira";
  text: string;
  image?: ImageInfo;
  thinking?: string;
  searches?: SearchActivity[];
  stopped?: true;
  replyTo?: number;
  at: number;
};
export type HistoryPage = { messages: Row[]; nextBefore: number | null };
