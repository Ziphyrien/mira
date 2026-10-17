import type { Sql } from "./storage";
/** Shared table mechanics. Domain stores own every key and value format. */
export class KeyValue {
  constructor(private readonly sql: Sql) {
    sql.exec("CREATE TABLE IF NOT EXISTS mira_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  }
  get(key: string): string | undefined {
    return this.sql.exec<{ v: string }>("SELECT v FROM mira_kv WHERE k = ?", key).toArray()[0]?.v;
  }
  set(key: string, value: string) {
    this.sql.exec("INSERT OR REPLACE INTO mira_kv (k, v) VALUES (?, ?)", key, value);
  }
  delete(key: string) {
    this.sql.exec("DELETE FROM mira_kv WHERE k = ?", key);
  }
}
