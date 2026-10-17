import type { SpaceSummary } from "../../../src/lib/contracts";
import type { Sql } from "../../core/storage";
const MINTS_PER_DAY = 30;
/** Strongly consistent global space projection and abuse counters. */
export class SpaceIndex {
  constructor(private readonly sql: Sql) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL, messages INTEGER NOT NULL, cost REAL NOT NULL)",
    );
    sql.exec("CREATE TABLE IF NOT EXISTS mints (k TEXT PRIMARY KEY, n INTEGER NOT NULL)");
  }
  touch(row: Omit<SpaceSummary, "seen">) {
    this.sql.exec(
      "INSERT INTO spaces (id, name, created, seen, messages, cost) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, seen=excluded.seen, messages=excluded.messages, cost=excluded.cost",
      row.id,
      row.name,
      row.created,
      Date.now(),
      row.messages,
      row.cost,
    );
  }
  has(id: string): boolean {
    return this.sql.exec("SELECT 1 FROM spaces WHERE id = ?", id).toArray().length > 0;
  }
  mint(ipDay: string): boolean {
    const sql = this.sql;
    const n = Number(
      sql.exec<{ n: number }>("SELECT n FROM mints WHERE k = ?", ipDay).toArray()[0]?.n ?? 0,
    );
    if (n >= MINTS_PER_DAY) return false;
    sql.exec("INSERT OR REPLACE INTO mints (k, n) VALUES (?, ?)", ipDay, n + 1);
    return true;
  }
  list(query: string, offset: number) {
    const sql = this.sql,
      like = `%${query}%`;
    const items = sql
      .exec<SpaceSummary>(
        "SELECT id, name, created, seen, messages, cost FROM spaces WHERE name LIKE ? OR id LIKE ? ORDER BY seen DESC LIMIT 50 OFFSET ?",
        like,
        like,
        offset,
      )
      .toArray();
    const totals = sql
      .exec<{ total: number; messages: number; cost: number }>(
        "SELECT COUNT(*) AS total, COALESCE(SUM(messages), 0) AS messages, COALESCE(SUM(cost), 0) AS cost FROM spaces",
      )
      .one();
    return { items, ...totals };
  }
  remove(id: string) {
    this.sql.exec("DELETE FROM spaces WHERE id = ?", id);
  }
}
