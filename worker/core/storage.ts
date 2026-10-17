import type { AiConfiguration } from "../plugins/models/api";
import type { AiModelInfo, SpaceSummary } from "../../src/lib/contracts";

export type Sql = Pick<SqlStorage, "exec">;
export type AtomicStorage = { readonly sql: Sql; transactionSync<T>(callback: () => T): T };
export type DirectoryPort = {
  aiConfiguration(): Promise<AiConfiguration>;
  chatModel(): Promise<AiModelInfo | null>;
  touch(row: Omit<SpaceSummary, "seen">): Promise<void>;
  remove(id: string): Promise<void>;
};

/** One runtime generation. Every feature SQL write is fenced; platform cleanup uses the native storage. */
export type ScopePlatform = {
  readonly storage: AtomicStorage & {
    transaction<T>(callback: () => Promise<T>): Promise<T>;
    setAlarm(time: number | Date): Promise<void>;
  };
  waitUntil(work: Promise<unknown>): void;
};
export class SpaceScope {
  readonly storage: AtomicStorage;
  private active = true;
  private readonly lifetime = new AbortController();
  get signal() {
    return this.lifetime.signal;
  }
  private pendingAlarm = false;
  private work = new Set<Promise<unknown>>();
  constructor(
    readonly platform: ScopePlatform,
    readonly directory: DirectoryPort,
  ) {
    this.storage = {
      sql: {
        exec: <T extends Record<string, SqlStorageValue>>(
          query: string,
          ...bindings: unknown[]
        ) => {
          this.assert();
          return platform.storage.sql.exec<T>(query, ...bindings);
        },
      },
      transactionSync: <T>(callback: () => T): T => {
        this.assert();
        return platform.storage.transactionSync(callback);
      },
    };
    this.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS mira_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
    );
  }
  assert() {
    if (!this.active) throw new Error("Space runtime was replaced");
  }
  get alive() {
    return this.active;
  }
  retire() {
    this.active = false;
    this.lifetime.abort(new Error("Space runtime was replaced"));
  }
  track<T>(work: Promise<T>): Promise<T> {
    const observed = work.finally(() => this.work.delete(observed));
    this.work.add(observed);
    return observed;
  }
  background(work: Promise<unknown>, event: string) {
    this.platform.waitUntil(
      this.track(work).catch((error: unknown) => {
        if (this.active) console.error(JSON.stringify({ event, error: String(error) }));
      }),
    );
  }
  async drain() {
    while (this.work.size) await Promise.allSettled(this.work);
  }
  wake() {
    if (!this.active || this.pendingAlarm) return;
    this.pendingAlarm = true;
    this.background(
      this.platform.storage.setAlarm(Date.now() + 15_000).catch((error: unknown) => {
        this.pendingAlarm = false;
        throw error;
      }),
      "space.alarm",
    );
  }
  alarmDelivered() {
    this.pendingAlarm = false;
  }
}
