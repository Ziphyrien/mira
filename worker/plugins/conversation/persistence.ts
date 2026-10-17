import type { ChatReply, SearchActivity } from "../../../src/lib/contracts";
import { KeyValue } from "../../core/kv";
import type { AtomicStorage, Sql } from "../../core/storage";
import type { ImageRewind } from "../images/ports";
import type { ConversationPersistencePort, Operation, ReplyMetadata } from "./ports";

/** Synchronous owner of request identity, journal, reply cache, metadata and replay cursors. */
export class ConversationPersistence implements ConversationPersistencePort {
  private readonly values: KeyValue;
  constructor(
    private readonly storage: AtomicStorage,
    private readonly images: ImageRewind,
    private readonly alive: () => boolean,
  ) {
    this.values = new KeyValue(storage.sql);
  }
  static restoreMetadata(sql: Sql, messages: { id: number; reply?: ReplyMetadata }[]) {
    sql.exec(
      "DELETE FROM mira_kv WHERE k IN ('active-operation', 'last-operation', 'turn-id') OR k LIKE 'operation:%' OR k LIKE 'reply:%' OR k LIKE 'reply-to:%' OR k LIKE 'thinking:%' OR k LIKE 'searches:%' OR k LIKE 'stopped:%' OR k LIKE 'cancelled-request:%' OR k LIKE 'search-owner:%' OR k LIKE 'search-activity:%'",
    );
    const values = new KeyValue(sql);
    values.set("memory-epoch", crypto.randomUUID());
    for (const { id, reply } of messages) {
      if (!reply) continue;
      if (reply.thinking !== undefined) values.set(`thinking:${id}`, reply.thinking);
      if (reply.replyTo !== undefined) values.set(`reply-to:${id}`, String(reply.replyTo));
      if (reply.searches) values.set(`searches:${id}`, JSON.stringify(reply.searches));
      if (reply.stopped) values.set(`stopped:${id}`, "1");
    }
  }
  /** The DO records intent before opening any model/runtime resource. */
  static cancel(sql: Sql, id: string) {
    new KeyValue(sql).set(`cancelled-request:${id}`, "1");
  }
  cancel(id: string) {
    ConversationPersistence.cancel(this.storage.sql, id);
  }
  isCancelled(id: string) {
    return Boolean(this.values.get(`cancelled-request:${id}`));
  }
  read(id: string): Operation | undefined {
    const value = this.values.get(`operation:${id}`);
    return value ? (JSON.parse(value) as Operation) : undefined;
  }
  active() {
    const id = this.values.get("active-operation");
    return id ? this.read(id) : undefined;
  }
  last() {
    const id = this.values.get("last-operation");
    return id ? this.read(id) : undefined;
  }
  save(operation: Operation) {
    this.values.set(`operation:${operation.input.requestId}`, JSON.stringify(operation));
  }
  begin(operation: Operation) {
    this.storage.transactionSync(() => {
      this.save(operation);
      this.values.set("active-operation", operation.input.requestId);
      this.values.set("last-operation", operation.input.requestId);
    });
  }
  reply(id: string): ChatReply | undefined {
    const value = this.values.get(`reply:${id}`);
    return value ? (JSON.parse(value) as ChatReply) : undefined;
  }
  replyTo(replyId: number) {
    const value = this.values.get(`reply-to:${replyId}`);
    return value === undefined ? undefined : Number(value);
  }
  complete(operation: Operation, reply?: ChatReply) {
    this.storage.transactionSync(() => {
      const id = operation.input.requestId;
      if (reply) {
        if (reply.thinking) this.values.set(`thinking:${reply.replyId}`, reply.thinking);
        if (reply.searches?.length)
          this.values.set(`searches:${reply.replyId}`, JSON.stringify(reply.searches));
        if (reply.stopped) this.values.set(`stopped:${reply.replyId}`, "1");
        this.values.set(`reply-to:${reply.replyId}`, String(reply.userId));
        this.values.set(`reply:${id}`, JSON.stringify(reply));
      }
      this.save(operation);
      for (const search of this.searches(operation.attemptId))
        this.values.delete(`search-owner:${search.id}`);
      this.values.delete(`search-activity:${operation.attemptId}`);
      this.storage.sql.exec("DELETE FROM mira_kv WHERE k = 'active-operation' AND v = ?", id);
    });
  }
  searches(attemptId: string): SearchActivity[] {
    return JSON.parse(this.values.get(`search-activity:${attemptId}`) ?? "[]") as SearchActivity[];
  }
  report(activity: SearchActivity) {
    if (!this.alive()) return;
    const ownerKey = `search-owner:${activity.id}`;
    const active = this.active();
    const attemptId =
      this.values.get(ownerKey) ?? (activity.status === "running" ? active?.attemptId : undefined);
    if (!attemptId || active?.attemptId !== attemptId || active.status !== "running") return;
    this.storage.transactionSync(() => {
      this.values.set(ownerKey, attemptId);
      const previous = this.searches(attemptId);
      const index = previous.findIndex((item) => item.id === activity.id);
      if (index < 0) previous.push(activity);
      else previous[index] = activity;
      this.values.set(`search-activity:${attemptId}`, JSON.stringify(previous));
    });
  }
  /** Called inside Memory.rewind's transaction, including image rows and the epoch. */
  truncate(to: number, preserveId: string) {
    this.images.truncate(to);
    this.values.set("memory-epoch", crypto.randomUUID());
    const replies = this.storage.sql
      .exec<{ k: string; v: string }>(
        "SELECT k, v FROM mira_kv WHERE k LIKE 'reply:%' AND json_extract(v, '$.replyId') >= ?",
        to,
      )
      .toArray();
    for (const reply of replies) {
      const id = reply.k.slice(6),
        old = this.read(id);
      if (id === preserveId) continue;
      if (old) this.save({ ...old, status: "superseded" });
      this.values.delete(reply.k);
    }
    const later = this.storage.sql
      .exec<{ v: string }>(
        "SELECT v FROM mira_kv WHERE k LIKE 'operation:%' AND json_extract(v, '$.userId') >= ?",
        to,
      )
      .toArray();
    for (const item of later) {
      const old = JSON.parse(item.v) as Operation;
      if (old.input.requestId !== preserveId) this.save({ ...old, status: "superseded" });
    }
    this.storage.sql.exec(
      "DELETE FROM mira_kv WHERE (k LIKE 'thinking:%' OR k LIKE 'reply-to:%' OR k LIKE 'searches:%' OR k LIKE 'stopped:%') AND CAST(substr(k, instr(k, ':') + 1) AS INTEGER) >= ?",
      to,
    );
  }
  metadata(ids: readonly number[]): Map<number, ReplyMetadata> {
    const keys = ids.flatMap((id) => [
      `thinking:${id}`,
      `reply-to:${id}`,
      `searches:${id}`,
      `stopped:${id}`,
    ]);
    const values = new Map(
      this.storage.sql
        .exec<{ k: string; v: string }>(
          "SELECT k, v FROM mira_kv WHERE k IN (SELECT value FROM json_each(?))",
          JSON.stringify(keys),
        )
        .toArray()
        .map((row) => [row.k, row.v]),
    );
    return new Map(
      ids.map((id) => {
        const thinking = values.get(`thinking:${id}`),
          replyTo = values.get(`reply-to:${id}`),
          searches = values.get(`searches:${id}`);
        return [
          id,
          {
            ...(thinking === undefined ? {} : { thinking }),
            ...(replyTo === undefined ? {} : { replyTo: Number(replyTo) }),
            ...(searches === undefined
              ? {}
              : { searches: JSON.parse(searches) as SearchActivity[] }),
            ...(values.has(`stopped:${id}`) ? { stopped: true as const } : {}),
          },
        ];
      }),
    );
  }
  epoch() {
    return this.values.get("memory-epoch") ?? "original";
  }
  turn() {
    return this.values.get("turn-id");
  }
  prepared(attemptId: string) {
    this.values.set("turn-id", attemptId);
  }
  logged() {
    return this.values.get("logged");
  }
  advance(id: string) {
    this.values.set("logged", id);
  }
}
