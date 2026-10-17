import { bytes } from "../../../src/lib/shared/text";
import { pages, page, clipEcho } from "./text";
import { end, start, flat as oneLine, fitView, renderView, type Part } from "./view";
import type { AtomicStorage, Sql } from "../../core/storage";
import type { MemoryTreeNode, MemoryTreePage } from "../../../src/lib/contracts";
import type { ReplyMetadata } from "../conversation/ports";
import type { Kind, LogMessage, Compact, MemoryPort } from "./ports";

// Memory behavior follows Unii 1.0.138; SQLite owns atomic persistence and replay.
// SQLite is the DO equivalent of main/*.jsonl, tree/*.jsonl and view.json.
export const NODE = 512;
const VIEW_HIGH = 128_000;
const COMPACT_HIGH = 32_000;
const JOBS = 64;
const PLACEHOLDER = "(not summarized yet: zoom it)";
const RULER = "-".repeat(NODE);

type Node = { text: string; size: number };
type Job = Part & { state: "ready" | "running" | "failed" };
type ViewState = {
  version: 1 | 2;
  view: Part[];
  compact: Part[];
  shrinking: boolean;
  compactShrinking: boolean;
  frozen?: string;
};

const key = (p: Part) => `${p.l}:${p.i}`;

export class Memory implements MemoryPort {
  readonly sql: Sql;
  T: number;
  revision = 0;
  private state: ViewState;
  private readonly busy = new Set<string>();
  private readonly waiters = new Set<() => void>();
  private abort = new AbortController();
  private closed = false;
  private paused = false;

  constructor(
    private readonly storage: AtomicStorage,
    private readonly compact: Compact,
    private readonly onWork: (work: Promise<void>) => void,
  ) {
    this.sql = storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS mira_memory_log (i INTEGER PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, size INTEGER NOT NULL, date INTEGER NOT NULL)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS mira_memory_archive (branch TEXT NOT NULL, i INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, size INTEGER NOT NULL, date INTEGER NOT NULL, PRIMARY KEY (branch, i))",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS mira_memory_node (l INTEGER NOT NULL, i INTEGER NOT NULL, text TEXT NOT NULL, size INTEGER NOT NULL, date INTEGER NOT NULL, PRIMARY KEY (l, i))",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS mira_memory_job (l INTEGER NOT NULL, i INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'ready', PRIMARY KEY (l, i))",
    );
    this.sql.exec(
      "CREATE INDEX IF NOT EXISTS mira_memory_job_ready ON mira_memory_job (state, l, i)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS mira_memory_state (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS mira_memory_source (source TEXT PRIMARY KEY, i INTEGER NOT NULL)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS mira_memory_count (id INTEGER PRIMARY KEY CHECK (id = 1), summaries INTEGER NOT NULL)",
    );
    for (const table of ["mira_memory_log", "mira_memory_archive"]) {
      if (
        !this.sql
          .exec<{ name: string }>(`PRAGMA table_info(${table})`)
          .toArray()
          .some((c) => c.name === "image")
      )
        this.sql.exec(`ALTER TABLE ${table} ADD COLUMN image TEXT`);
    }
    this.T = Number(
      this.sql.exec<{ n: number }>("SELECT COALESCE(MAX(i) + 1, 0) AS n FROM mira_memory_log").one()
        .n,
    );
    const saved = this.sql
      .exec<{ data: string }>("SELECT data FROM mira_memory_state WHERE id = 1")
      .toArray()[0];
    const count = this.sql
      .exec<{ summaries: number }>("SELECT summaries FROM mira_memory_count WHERE id = 1")
      .toArray()[0];
    if (saved) {
      this.state = JSON.parse(saved.data) as ViewState;
      if (this.state.version !== 1 && this.state.version !== 2)
        throw new Error("Unsupported memory state version");
      if (!count || !Number.isSafeInteger(count.summaries) || count.summaries < 0)
        throw new Error("Missing or invalid memory summary count");
      if (
        !Array.isArray(this.state.view) ||
        !Array.isArray(this.state.compact) ||
        typeof this.state.shrinking !== "boolean" ||
        typeof this.state.compactShrinking !== "boolean" ||
        (this.state.frozen !== undefined && typeof this.state.frozen !== "string")
      )
        throw new Error("Invalid persisted memory state");
    } else {
      const view: Part[] = [];
      const recover = (p: Part) => {
        if (p.l === 0 || this.node(p)) view.push(p);
        else {
          recover({ l: p.l - 1, i: p.i * 2 });
          recover({ l: p.l - 1, i: p.i * 2 + 1 });
        }
      };
      for (let at = 0; at < this.T;) {
        const l = Math.floor(Math.log2(this.T - at));
        recover({ l, i: at / 2 ** l });
        at += 2 ** l;
      }
      this.state = {
        version: 2,
        view,
        compact: [...view],
        shrinking: false,
        compactShrinking: false,
      };
      storage.transactionSync(() => {
        this.sql.exec(
          "INSERT OR IGNORE INTO mira_memory_count (id, summaries) SELECT 1, COUNT(*) FROM mira_memory_node",
        );
        this.save();
      });
    }
    this.validate(this.state.view);
    this.validate(this.state.compact, false);
    this.state.version = 2;
    this.fit();
    this.save();
    // Reconstruct unfinished work from the durable tree, including a missing queue.
    this.sql.exec(
      "INSERT OR IGNORE INTO mira_memory_job (l, i) SELECT 0, log.i FROM mira_memory_log log WHERE NOT EXISTS (SELECT 1 FROM mira_memory_node node WHERE node.l = 0 AND node.i = log.i)",
    );
    this.sql.exec(
      "INSERT OR IGNORE INTO mira_memory_job (l, i) SELECT a.l + 1, a.i / 2 FROM mira_memory_node a JOIN mira_memory_node b ON b.l = a.l AND b.i = a.i + 1 WHERE a.i % 2 = 0 AND NOT EXISTS (SELECT 1 FROM mira_memory_node parent WHERE parent.l = a.l + 1 AND parent.i = a.i / 2)",
    );
    this.sql.exec("UPDATE mira_memory_job SET state = 'ready' WHERE state = 'running'");
    this.fit();
    this.save();
  }

  private validate(parts: Part[], complete = true) {
    let next = 0;
    for (const p of parts) {
      if (
        !Number.isSafeInteger(p.l) ||
        p.l < 0 ||
        !Number.isSafeInteger(p.i) ||
        p.i < 0 ||
        start(p) !== next
      )
        throw new Error("Invalid persisted memory view");
      next = end(p);
    }
    if (next > this.T || (complete && next !== this.T))
      throw new Error("Memory view does not cover the log");
  }

  private save() {
    this.revision++;
    this.sql.exec(
      "INSERT INTO mira_memory_state (id, data) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data",
      JSON.stringify(this.state),
    );
  }

  private node(p: Part): Node | undefined {
    return this.sql
      .exec<Node>("SELECT text, size FROM mira_memory_node WHERE l = ? AND i = ?", p.l, p.i)
      .toArray()[0];
  }

  /** Immutable, idempotent batches preserve transcript order across crash recovery. */
  record(source: string, messages: readonly LogMessage[], commit?: () => void): boolean {
    return this.write(messages, source, commit) !== undefined;
  }

  append(kind: Kind, text: string, commit?: () => void): number {
    return this.write([{ kind, text }], undefined, commit)!;
  }

  private write(
    messages: readonly LogMessage[],
    source?: string,
    commit?: () => void,
  ): number | undefined {
    if (this.closed) throw new Error("Memory is closed");
    if (
      source &&
      this.sql.exec("SELECT 1 FROM mira_memory_source WHERE source = ?", source).toArray().length
    ) {
      if (commit) this.storage.transactionSync(commit);
      return undefined;
    }
    const first = this.T;
    const previous = this.state;
    this.state = { ...previous, view: [...previous.view], compact: [...previous.compact] };
    try {
      this.storage.transactionSync(() => {
        this.retryFailed();
        for (const m of messages) {
          const texts = pages((m.kind === "echo" ? clipEcho(m.text) : m.text).toWellFormed());
          for (const [part, text] of texts.entries()) {
            const image = part === texts.length - 1 ? (m.image ?? null) : null;
            const i = this.T++;
            this.sql.exec(
              "INSERT INTO mira_memory_log (i, kind, text, size, date, image) VALUES (?, ?, ?, ?, ?, ?)",
              i,
              m.kind,
              text,
              bytes(`${m.kind}: ${text}`),
              m.date ?? Date.now(),
              image,
            );
            this.sql.exec("INSERT INTO mira_memory_job (l, i) VALUES (0, ?)", i);
          }
        }
        if (source)
          this.sql.exec("INSERT INTO mira_memory_source (source, i) VALUES (?, ?)", source, first);
        this.fit(true);
        this.save();
        commit?.();
      });
    } catch (error) {
      this.T = first;
      this.state = previous;
      throw error;
    }
    this.pump();
    return first;
  }

  private firstUnbuilt(): number {
    return Number(
      this.sql
        .exec<{ i: number }>(
          "SELECT COALESCE(MIN(i), ?) AS i FROM mira_memory_job WHERE l = 0",
          this.T,
        )
        .one().i,
    );
  }

  private fit(admission = false) {
    const main = fitView(this.state.view, this.state.shrinking, this.T, VIEW_HIGH, admission, (p) =>
      this.node(p),
    );
    const seen = fitView(
      this.state.compact,
      this.state.compactShrinking,
      this.firstUnbuilt(),
      COMPACT_HIGH,
      admission,
      (p) => this.node(p),
    );
    this.state.view = main.parts;
    this.state.shrinking = main.batch;
    this.state.compact = seen.parts;
    this.state.compactShrinking = seen.batch;
  }

  private retryFailed() {
    this.sql.exec("UPDATE mira_memory_job SET state = 'ready' WHERE state = 'failed'");
  }

  private candidates(): Job[] {
    const edge =
      this.sql
        .exec<{ i: number }>(
          "SELECT i FROM mira_memory_job WHERE l = 0 ORDER BY i LIMIT 1 OFFSET ?",
          JOBS - 1,
        )
        .toArray()[0]?.i ?? this.T;
    return this.sql
      .exec<Job>(
        "SELECT l, i, state FROM mira_memory_job WHERE state = 'ready' AND CASE WHEN l = 0 THEN i ELSE (i + 1) * (1 << l) END <= ? ORDER BY CASE WHEN l = 0 THEN i ELSE (i + 1) * (1 << l) END, l DESC",
        edge,
      )
      .toArray();
  }

  pump() {
    if (this.closed || this.paused) return;
    for (;;) {
      const free: (Part & { text: string })[] = [];
      for (const p of this.candidates()) {
        if (this.busy.size >= JOBS) break;
        const k = key(p);
        if (this.busy.has(k)) continue;
        const { input, task, limit } = this.compactionInput(p);
        if (bytes(input) <= NODE) {
          free.push({ ...p, text: input });
          continue;
        }
        this.busy.add(k);
        this.sql.exec(
          "UPDATE mira_memory_job SET state = 'running' WHERE l = ? AND i = ?",
          p.l,
          p.i,
        );
        const work = this.compact(this.context(limit), task, this.abort.signal)
          .then((text) => {
            if (!this.closed && !this.paused) this.storeNodes([{ ...p, text }]);
          })
          .catch((error: unknown) => {
            if (!this.closed && !this.paused) {
              this.sql.exec(
                "UPDATE mira_memory_job SET state = 'failed' WHERE l = ? AND i = ?",
                p.l,
                p.i,
              );
              console.error(
                JSON.stringify({
                  event: "memory.compaction.failed",
                  node: k,
                  error: String(error),
                }),
              );
            }
          })
          .finally(() => {
            this.busy.delete(k);
            this.pump();
            if (!this.closed && !this.paused) {
              this.fit();
              this.save();
            }
            for (const notify of this.waiters) notify();
          });
        this.onWork(work);
      }
      if (!free.length) break;
      this.storeNodes(free);
      this.fit();
      this.save();
    }
  }

  private context(limit: number): string {
    const upto = Math.min(limit, this.firstUnbuilt());
    return this.renderParts(this.state.compact.filter((p) => end(p) <= upto));
  }

  private compactionInput(p: Part) {
    let input: string, task: string, limit: number;
    if (p.l === 0) {
      const m = this.sql
        .exec<{ kind: Kind; text: string; image: string | null }>(
          "SELECT kind, text, image FROM mira_memory_log WHERE i = ?",
          p.i,
        )
        .one();
      input = `${m.kind}: ${m.text}${m.image ? `\n[image ${m.image}]` : ""}`;
      limit = p.i;
      task = `Compaction: compress message ${p.i} into one line of at most 512 bytes\n(about 70 words), the length of this ruler:\n${RULER}\n<input>\n${input}\n</input>`;
    } else {
      const a = { l: p.l - 1, i: p.i * 2 },
        b = { l: p.l - 1, i: p.i * 2 + 1 };
      const left = this.node(a),
        right = this.node(b);
      if (!left || !right) throw new Error("Compaction children are not built");
      input = `${oneLine(left.text)}\n${oneLine(right.text)}`;
      limit = end(p);
      task = `Compaction: merge lines ${start(a)}+${2 ** a.l} and ${start(b)}+${2 ** b.l}, adjacent, into one line of at most\n512 bytes (about 70 words), the length of this ruler:\n${RULER}\n<chat> may hold their messages, ${start(p)} to ${end(p) - 1}, in more detail: take details\nof them from there too.\n<input>\n${input}\n</input>`;
    }
    return { input, task, limit };
  }

  private storeNodes(parts: (Part & { text: string })[]) {
    this.revision++;
    this.storage.transactionSync(() => {
      for (const p of parts) {
        this.sql.exec(
          "INSERT INTO mira_memory_node (l, i, text, size, date) VALUES (?, ?, ?, ?, ?)",
          p.l,
          p.i,
          p.text,
          bytes(p.text),
          Date.now(),
        );
        this.sql.exec("DELETE FROM mira_memory_job WHERE l = ? AND i = ?", p.l, p.i);
        this.sql.exec("UPDATE mira_memory_count SET summaries = summaries + 1 WHERE id = 1");
      }
      for (const p of parts) {
        const sibling = { l: p.l, i: p.i % 2 === 0 ? p.i + 1 : p.i - 1 };
        const parent = { l: p.l + 1, i: Math.floor(p.i / 2) };
        if (end(parent) <= this.T && this.node(sibling) && !this.node(parent))
          this.sql.exec(
            "INSERT OR IGNORE INTO mira_memory_job (l, i) VALUES (?, ?)",
            parent.l,
            parent.i,
          );
      }
    });
  }

  working(): boolean {
    return this.busy.size > 0 || this.candidates().length > 0;
  }

  settle(ms: number): Promise<boolean> {
    this.pump();
    const ready = () =>
      !this.sql.exec("SELECT 1 FROM mira_memory_job WHERE l = 0 LIMIT 1").toArray().length;
    if (ready()) return Promise.resolve(true);
    if (this.closed || !this.working()) return Promise.resolve(false);
    return new Promise((resolve) => {
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve(ok);
      };
      const check = () => {
        if (this.closed || ready()) finish(!this.closed);
        else if (!this.working()) finish(false);
      };
      const timer = setTimeout(() => finish(false), ms);
      this.waiters.add(check);
    });
  }

  async prepare(ms: number): Promise<boolean> {
    this.retryFailed();
    if (!(await this.settle(ms))) return false;
    this.fit();
    this.save();
    return true;
  }

  private renderParts(parts: Part[]): string {
    return renderView(parts, (p) => this.node(p));
  }
  private prefix(parts: Part[], limit: number): Part[] {
    const out: Part[] = [];
    const visit = (p: Part) => {
      if (start(p) >= limit) return;
      if (end(p) <= limit) out.push(p);
      else {
        visit({ l: p.l - 1, i: p.i * 2 });
        visit({ l: p.l - 1, i: p.i * 2 + 1 });
      }
    };
    for (const p of parts) visit(p);
    return out;
  }
  render(): string {
    return this.renderParts(this.state.view);
  }
  renderBefore(i: number): string {
    if (!Number.isSafeInteger(i) || i < 0 || i > this.T) throw new Error("Invalid memory boundary");
    return this.renderParts(this.prefix(this.state.view, i));
  }
  async rewind(to: number, branch: string, commit: () => void): Promise<void> {
    if (this.closed || this.paused || !Number.isSafeInteger(to) || to < 0 || to > this.T)
      throw new Error("Invalid memory rewind");
    this.paused = true;
    this.abort.abort(new Error("Memory branch was replaced"));
    if (this.busy.size)
      await new Promise<void>((resolve) => {
        const check = () => {
          if (!this.busy.size) {
            this.waiters.delete(check);
            resolve();
          }
        };
        this.waiters.add(check);
        check();
      });
    const previous = this.state,
      previousT = this.T;
    try {
      this.storage.transactionSync(() => {
        this.sql.exec(
          "INSERT INTO mira_memory_archive (branch, i, kind, text, size, date, image) SELECT ?, i, kind, text, size, date, image FROM mira_memory_log WHERE i >= ?",
          branch,
          to,
        );
        this.sql.exec("DELETE FROM mira_memory_log WHERE i >= ?", to);
        this.sql.exec("DELETE FROM mira_memory_source WHERE i >= ?", to);
        this.sql.exec("DELETE FROM mira_memory_node WHERE (i + 1) * (1 << l) > ?", to);
        this.sql.exec("DELETE FROM mira_memory_job WHERE (i + 1) * (1 << l) > ?", to);
        this.state = {
          version: 2,
          view: this.prefix(previous.view, to),
          compact: this.prefix(previous.compact, to),
          shrinking: false,
          compactShrinking: false,
        };
        this.T = to;
        this.validate(this.state.view);
        this.validate(this.state.compact, false);
        this.save();
        commit();
      });
    } catch (error) {
      this.state = previous;
      this.T = previousT;
      throw error;
    } finally {
      this.sql.exec("UPDATE mira_memory_job SET state = 'ready' WHERE state = 'running'");
      this.abort = new AbortController();
      this.paused = false;
      this.pump();
    }
  }
  freeze(view: string | undefined) {
    this.state.frozen = view;
    this.save();
  }
  frozen(): string {
    if (this.state.frozen === undefined) throw new Error("Missing frozen view for active turn");
    return this.state.frozen;
  }

  tree(id?: number, n?: number): MemoryTreePage | null {
    const describe = (p: Part): MemoryTreeNode => {
      const node = this.node(p);
      return { id: start(p), n: 2 ** p.l, text: oneLine(node?.text ?? PLACEHOLDER), ready: !!node };
    };
    if (id === undefined && n === undefined)
      return { total: this.T, nodes: this.state.view.map(describe) };
    if (
      id === undefined ||
      n === undefined ||
      !Number.isSafeInteger(id) ||
      id < 0 ||
      !Number.isSafeInteger(n) ||
      n < 1 ||
      !Number.isInteger(Math.log2(n)) ||
      id % n !== 0 ||
      id + n > this.T
    )
      return null;
    if (n === 1) {
      const row = this.sql
        .exec<{ kind: string; text: string; date: number }>(
          "SELECT kind, text, date FROM mira_memory_log WHERE i = ?",
          id,
        )
        .one();
      return {
        total: this.T,
        nodes: [],
        original: { kind: row.kind, text: row.text, at: row.date },
      };
    }
    return {
      total: this.T,
      nodes: [0, 1].map((offset) => describe({ l: Math.log2(n) - 1, i: id / (n / 2) + offset })),
    };
  }
  image(id: number): string | undefined {
    return (
      this.sql
        .exec<{ image: string | null }>("SELECT image FROM mira_memory_log WHERE i = ?", id)
        .toArray()[0]?.image ?? undefined
    );
  }

  zoom(id: number, n: number, at = 0): string {
    if (
      !Number.isSafeInteger(id) ||
      id < 0 ||
      !Number.isSafeInteger(n) ||
      n < 1 ||
      !Number.isInteger(Math.log2(n)) ||
      id % n !== 0 ||
      id + n > this.T ||
      !Number.isSafeInteger(at) ||
      at < 0
    ) {
      const roots: string[] = [];
      for (let at = 0; at < this.T;) {
        const size = 2 ** Math.floor(Math.log2(this.T - at));
        roots.push(`${at}+${size}`);
        at += size;
      }
      return `No line ${id}+${n}: n is a power of 2, id a multiple of n. The tree's roots: ${roots.join(", ")}.`;
    }
    if (n === 1) {
      const m = this.sql
        .exec<{ kind: Kind; text: string; image: string | null }>(
          "SELECT kind, text, image FROM mira_memory_log WHERE i = ?",
          id,
        )
        .one();
      return `${id}+0|${m.kind}: ${page(m.text, at)}${at === 0 && m.image ? `\n[image ${m.image}]` : ""}`;
    }
    const l = Math.log2(n) - 1;
    return [0, 1]
      .map((offset) => {
        const p = { l, i: id / (n / 2) + offset };
        return `${start(p)}+${n / 2}|${oneLine(this.node(p)?.text ?? PLACEHOLDER)}`;
      })
      .join("\n");
  }

  date(id: number, timeZone: string): string {
    const m = this.sql
      .exec<{ date: number }>("SELECT date FROM mira_memory_log WHERE i = ?", id)
      .toArray()[0];
    return m
      ? new Intl.DateTimeFormat("zh-CN", {
          timeZone,
          dateStyle: "full",
          timeStyle: "short",
        }).format(m.date)
      : `No message ${id}.`;
  }

  input(source: string) {
    const first = this.sql
      .exec<{ i: number }>("SELECT i FROM mira_memory_source WHERE source = ?", source)
      .toArray()[0];
    return first ? this.user(first.i) : undefined;
  }
  user(i: number) {
    const rows = this.sql
      .exec<{ i: number; text: string }>(
        "SELECT i, text FROM mira_memory_log WHERE kind = 'user' AND i >= ? AND i < COALESCE((SELECT MIN(i) FROM mira_memory_source WHERE i > ?), 9223372036854775807) ORDER BY i",
        i,
        i,
      )
      .toArray();
    return rows[0]?.i === i ? { i, text: rows.map((row) => row.text).join("") } : undefined;
  }

  history(before: number | undefined, limit: number) {
    return this.sql
      .exec<{ i: number; kind: "user" | "mira"; text: string; at: number }>(
        "SELECT i, kind, text, date AS at FROM mira_memory_log WHERE kind IN ('user', 'mira') AND i < ? ORDER BY i DESC LIMIT ?",
        before ?? Number.MAX_SAFE_INTEGER,
        limit,
      )
      .toArray()
      .reverse();
  }
  lines() {
    return this.state.view.flatMap((p) => {
      const node = this.node(p);
      return node ? [{ start: start(p), count: 2 ** p.l, text: node.text }] : [];
    });
  }
  *dump(
    imageForUser: (id: number) => string | undefined = () => undefined,
    replyForMessage: (id: number) => ReplyMetadata | undefined = () => undefined,
  ): Generator<string> {
    const total = this.T;
    const parts = (items: Part[]) => items.map((p) => ({ id: start(p), n: 2 ** p.l }));
    yield (
      '{"version":2,"view":' +
        JSON.stringify({
          parts: parts(this.state.view),
          seen: parts(this.state.compact),
          batch: this.state.shrinking,
          seenBatch: this.state.compactShrinking,
        }) +
        ',"sources":['
    );
    let sourceSeparator = "";
    for (const row of this.sql.exec<{ source: string; i: number }>(
      "SELECT source, i FROM mira_memory_source WHERE i < ? ORDER BY i, source",
      total,
    )) {
      yield sourceSeparator + JSON.stringify({ source: row.source, id: row.i });
      sourceSeparator = ",";
    }
    yield '],"messages":[';
    for (const row of this.sql.exec<{
      i: number;
      kind: string;
      text: string;
      date: number;
      image: string | null;
    }>("SELECT i, kind, text, date, image FROM mira_memory_log WHERE i < ? ORDER BY i", total)) {
      yield (
        (row.i ? "," : "") +
          JSON.stringify({
            id: row.i,
            kind: row.kind,
            text: row.text,
            date: new Date(row.date).toISOString(),
            reply: replyForMessage(row.i),
            ...((row.image ?? imageForUser(row.i))
              ? { images: [row.image ?? imageForUser(row.i)] }
              : {}),
          })
      );
    }
    yield '],"summaries":[';
    let separator = "";
    for (const row of this.sql.exec<{ l: number; i: number; text: string }>(
      "SELECT l, i, text FROM mira_memory_node WHERE (i + 1) * (1 << l) <= ? ORDER BY l, i",
      total,
    )) {
      yield separator + JSON.stringify({ id: start(row), n: 2 ** row.l, text: row.text });
      separator = ",";
    }
    yield '],"images":';
  }

  stats() {
    return {
      messages: this.T,
      summaries: Number(
        this.sql
          .exec<{ summaries: number }>("SELECT summaries FROM mira_memory_count WHERE id = 1")
          .one().summaries,
      ),
      viewLines: this.state.view.length,
      pending: this.state.view.filter((p) => !this.node(p)).length,
    };
  }
  close() {
    this.closed = true;
    this.abort.abort();
    for (const notify of this.waiters) notify();
  }
}
