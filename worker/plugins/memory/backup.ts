import type { MemoryBackup } from "../../../src/lib/contracts/memory-backup";
import { bytes } from "../../../src/lib/shared/text";
import type { AtomicStorage } from "../../core/storage";

/** Called inside the space's replacement transaction after its runtime has closed. */
export function restoreMemoryBackup(storage: AtomicStorage, backup: MemoryBackup): void {
  const sql = storage.sql;
  for (const table of ["log", "archive", "node", "job", "state", "source", "count"])
    sql.exec(`DELETE FROM mira_memory_${table}`);
  for (const m of backup.messages)
    sql.exec(
      "INSERT INTO mira_memory_log (i, kind, text, size, date, image) VALUES (?, ?, ?, ?, ?, ?)",
      m.id,
      m.kind,
      m.text,
      bytes(`${m.kind}: ${m.text}`),
      Date.parse(m.date),
      m.images?.[0] ?? null,
    );
  for (const node of backup.summaries)
    sql.exec(
      "INSERT INTO mira_memory_node (l, i, text, size, date) VALUES (?, ?, ?, ?, ?)",
      Math.log2(node.n),
      node.id / node.n,
      node.text,
      bytes(node.text),
      Date.now(),
    );
  // Keep message grouping; imported source identities must not collide with new Pi entry ids.
  const sources =
    backup.sources ??
    backup.messages
      .filter((m) => m.kind === "user")
      .map((m) => ({ source: String(m.id), id: m.id }));
  for (const [index, s] of sources.entries())
    sql.exec("INSERT INTO mira_memory_source (source, i) VALUES (?, ?)", `import:${index}`, s.id);
  sql.exec("INSERT INTO mira_memory_count (id, summaries) VALUES (1, ?)", backup.summaries.length);
  if (backup.view) {
    const parts = (items: { id: number; n: number }[]) =>
      items.map((p) => ({ l: Math.log2(p.n), i: p.id / p.n }));
    sql.exec(
      "INSERT INTO mira_memory_state (id, data) VALUES (1, ?)",
      JSON.stringify({
        version: 2,
        view: parts(backup.view.parts),
        compact: parts(backup.view.seen),
        shrinking: backup.view.batch,
        compactShrinking: backup.view.seenBatch,
      }),
    );
  }
}
