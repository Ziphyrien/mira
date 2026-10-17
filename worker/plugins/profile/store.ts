import { ProfileInput, SpeechPreferences, DEFAULT_SPEECH } from "../../../src/lib/contracts";
import type { Sql } from "../../core/storage";
import { KeyValue } from "../../core/kv";
import type { ProfilePersistencePort } from "./api";
export class ProfileStore implements ProfilePersistencePort {
  private readonly values: KeyValue;
  constructor(sql: Sql) {
    this.values = new KeyValue(sql);
    sql.exec(
      "INSERT OR IGNORE INTO mira_kv (k, v) VALUES ('speech', ?)",
      JSON.stringify(DEFAULT_SPEECH),
    );
  }
  get() {
    const value = this.values.get("profile");
    return value ? ProfileInput.parse(JSON.parse(value)) : null;
  }
  set(input: unknown) {
    this.values.set("profile", JSON.stringify(ProfileInput.parse(input)));
  }
  speech() {
    return this.get() ? SpeechPreferences.parse(JSON.parse(this.values.get("speech")!)) : null;
  }
  setSpeech(input: unknown) {
    if (!this.get()) throw new Error("Account is not configured");
    const preferences = SpeechPreferences.parse(input);
    this.values.set("speech", JSON.stringify(preferences));
    return preferences;
  }
}
