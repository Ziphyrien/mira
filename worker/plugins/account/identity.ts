import { KeyValue } from "../../core/kv";
import type { Sql } from "../../core/storage";
/** Account identity survives runtime replacement; platform wipe reads through this same owner. */
export class AccountIdentity {
  private readonly values: KeyValue;
  constructor(sql: Sql) {
    this.values = new KeyValue(sql);
  }
  uid() {
    return this.values.get("uid");
  }
  identify(uid: string) {
    this.values.set("uid", uid);
  }
  created() {
    return Number(this.values.get("created") ?? Date.now());
  }
  initialize(uid: string) {
    this.identify(uid);
    if (!this.values.get("created")) this.values.set("created", String(Date.now()));
  }
}
