import { z } from "zod";
import type { AtomicStorage } from "../../core/storage";
import {
  PRESENCE_FRESH_FOR_MS,
  type PagePresence,
} from "../../../src/lib/contracts/research-presence";
const inputShape = z
  .object({
    tabId: z.string().uuid(),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    state: z.enum(["visible", "hidden", "left"]),
  })
  .strict();
type Row = {
  session_id: string;
  tab_id: string;
  sequence: number;
  state: "visible" | "hidden" | "left";
  seen_at: number;
};
export class ResearchPresence {
  constructor(private readonly storage: AtomicStorage) {
    storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS research_presence (session_id TEXT NOT NULL,tab_id TEXT NOT NULL,sequence INTEGER NOT NULL,state TEXT NOT NULL,seen_at INTEGER NOT NULL,PRIMARY KEY(session_id,tab_id))",
    );
  }
  record(sessionId: string, input: unknown) {
    const data = inputShape.parse(input),
      at = Date.now();
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        "INSERT INTO research_presence VALUES(?,?,?,?,?) ON CONFLICT(session_id,tab_id) DO UPDATE SET sequence=excluded.sequence,state=excluded.state,seen_at=excluded.seen_at WHERE excluded.sequence>research_presence.sequence",
        sessionId,
        data.tabId,
        data.sequence,
        data.state,
        at,
      );
      this.storage.sql.exec(
        "DELETE FROM research_presence WHERE session_id=? AND tab_id NOT IN (SELECT tab_id FROM research_presence WHERE session_id=? ORDER BY seen_at DESC LIMIT 8)",
        sessionId,
        sessionId,
      );
    });
    return { observedAt: at };
  }
  snapshots(at: number) {
    const groups = new Map<string, Row[]>();
    for (const row of this.storage.sql
      .exec<Row>("SELECT * FROM research_presence ORDER BY seen_at DESC")
      .toArray()) {
      const items = groups.get(row.session_id) ?? [];
      items.push(row);
      groups.set(row.session_id, items);
    }
    return new Map(
      [...groups].map(([id, rows]) => {
        const recent = rows.filter((row) => row.seen_at + PRESENCE_FRESH_FOR_MS > at);
        const current =
          recent.find((row) => row.state === "visible") ??
          recent.find((row) => row.state === "hidden") ??
          recent[0];
        const states = { visible: "foreground", hidden: "background", left: "left" } as const;
        const state: PagePresence["state"] = current ? states[current.state] : "unknown";
        return [
          id,
          {
            state,
            observedAt: at,
            lastSeenAt: rows[0].seen_at,
            freshUntil: current ? current.seen_at + PRESENCE_FRESH_FOR_MS : null,
          } satisfies PagePresence,
        ];
      }),
    );
  }
  remove(id: string) {
    this.storage.sql.exec("DELETE FROM research_presence WHERE session_id=?", id);
  }
  clear() {
    this.storage.sql.exec("DELETE FROM research_presence");
  }
}
