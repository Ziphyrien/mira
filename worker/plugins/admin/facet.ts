import { defineFacet, type Facet } from "@earendil-works/chord";
import type { Sql } from "../../core/storage";
import { SpaceIndex } from "./index";
import { IndexCommands } from "./api";
export function indexFacet(sql: Sql): Facet {
  return {
    name: "mira.directory.index",
    ...defineFacet((api) =>
      api.serve(IndexCommands, (_input, _principal, self) => {
        const indexResource = self.resource("index", {
          version: 1,
          open: () => new SpaceIndex(sql),
        });
        return {
          touch: (row) => indexResource.value.touch(row),
          has: (id) => indexResource.value.has(id),
          mint: (day) => indexResource.value.mint(day),
          list: ({ query, offset }) => indexResource.value.list(query, offset),
          remove: (id) => indexResource.value.remove(id),
        };
      }),
    ),
  };
}
