import { createContext } from "svelte";
import type { Node } from "comark";
import { citationId } from "#lib/shared/citations.js";
import type { SearchActivity, SearchSource } from "#lib/contracts/index.js";

export type Citation = SearchSource & { number: number };
export const [getCitations, setCitations] = createContext<{
  sources: () => Citation[];
  open: (source: Citation) => void;
}>();
export function sourceDomain(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

/** Only parsed citation links can select a source; code and ordinary URLs cannot. */
export function citationsFor(
  nodes: readonly Node[],
  searches: readonly SearchActivity[],
): Citation[] {
  const sources = new Map(
    searches.flatMap((search) => search.sources).map((source) => [source.id, source]),
  );
  const seen = new Set<string>();
  const cited: Citation[] = [];
  function visit(children: readonly Node[]) {
    for (const node of children) {
      if (typeof node === "string") continue;
      const [tag, attributes, ...nested] = node;
      if (tag === null || tag === "pre" || tag === "code") continue;
      if (tag === "a" && typeof attributes.href === "string") {
        const id = citationId(attributes.href);
        const source = id ? sources.get(id) : undefined;
        if (id && source && !seen.has(id)) {
          seen.add(id);
          cited.push({ ...source, number: cited.length + 1 });
        }
      }
      visit(nested);
    }
  }
  visit(nodes);
  return cited;
}
