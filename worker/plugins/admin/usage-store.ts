import { KeyValue } from "../../core/kv";
import type { Sql } from "../../core/storage";
/** One owner for the persisted compaction charge used by every usage projection. */
export class UsageLedger {
  private readonly values: KeyValue;
  constructor(sql: Sql) {
    this.values = new KeyValue(sql);
  }
  cost() {
    return Number(this.values.get("memory-cost") ?? 0);
  }
  charge(cost: number) {
    this.values.set("memory-cost", String(this.cost() + cost));
  }
}
