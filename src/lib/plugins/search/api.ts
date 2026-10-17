import { local, opaque } from "@earendil-works/chord";
import { Type } from "typebox";
import type { Row } from "#lib/contracts/index.js";

export interface SearchPort {
  readonly opened: boolean;
  readonly query: string;
  readonly error: string;
  readonly loading: boolean;
  readonly indexed: number;
  readonly results: readonly Row[];
  open(): void;
  retry(): void;
  close(): void;
  setQuery(query: string): void;
  pick(row: Row): Promise<void>;
}

export const Search = local("mira.web.search", {
  version: 1,
  input: Type.Object({}),
  members: { view: opaque<SearchPort>("mira.search-view@1") },
});
