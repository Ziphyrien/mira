import { addAll, createIndex, search } from "slimsearch";
import type { Row } from "#lib/contracts/index.js";
import { tokenize } from "#lib/shared/text.js";
/** Search returns IDs; authoritative message rows remain typed and retain optional metadata. */
export function buildIndex(rows: Row[]) {
  const source = new Map(rows.map((row) => [row.i, row]));
  const index = createIndex<number, Row>({
    idField: "i",
    fields: ["text"],
    storeFields: ["i"],
    tokenize,
    searchOptions: { prefix: true, combineWith: "AND", tokenize },
  });
  addAll(index, rows);
  return (query: string): Row[] =>
    search(index, query)
      .slice(0, 30)
      .flatMap((result) => {
        const row = source.get(result.id);
        return row ? [row] : [];
      });
}
