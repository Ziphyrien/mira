import { defineFacet, type Facet } from "@earendil-works/chord";
import type { Sql } from "../../core/storage";
import { ResearchIndex } from "./api";
export function researchIndexFacet(sql: Sql): Facet {
  return {
    name: "mira.research.index",
    ...defineFacet((api) =>
      api.serve(ResearchIndex, () => {
        sql.exec(
          "CREATE TABLE IF NOT EXISTS research_index (id TEXT PRIMARY KEY,topic TEXT NOT NULL,created INTEGER NOT NULL)",
        );
        sql.exec(
          "CREATE TABLE IF NOT EXISTS research_links (code TEXT PRIMARY KEY,study TEXT NOT NULL UNIQUE)",
        );
        return {
          share: (id) => {
            const existing = sql
              .exec<{ code: string }>("SELECT code FROM research_links WHERE study=?", id)
              .toArray()[0];
            if (existing) return existing.code;
            for (let attempt = 0; attempt < 5; attempt++) {
              const code = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(8))))
                .replaceAll("+", "-")
                .replaceAll("/", "_")
                .replaceAll("=", "");
              sql.exec("INSERT OR IGNORE INTO research_links VALUES(?,?)", code, id);
              const row = sql
                .exec<{ code: string }>("SELECT code FROM research_links WHERE study=?", id)
                .toArray()[0];
              if (row) return row.code;
            }
            throw new Error("Unable to allocate research link");
          },
          resolve: (code) =>
            sql
              .exec<{ study: string }>("SELECT study FROM research_links WHERE code=?", code)
              .toArray()[0]?.study ?? null,
          list: () =>
            sql
              .exec<{ id: string; topic: string; createdAt: number }>(
                "SELECT id,topic,created AS createdAt FROM research_index ORDER BY created DESC LIMIT 100",
              )
              .toArray(),
          remove: (id) => {
            sql.exec("DELETE FROM research_links WHERE study=?", id);
            sql.exec("DELETE FROM research_index WHERE id=?", id);
          },
          add: (entry) => {
            sql.exec(
              "INSERT OR REPLACE INTO research_index VALUES(?,?,?)",
              entry.id,
              entry.topic,
              entry.createdAt,
            );
          },
        };
      }),
    ),
  };
}
