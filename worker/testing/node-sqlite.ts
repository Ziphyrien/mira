import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { AtomicStorage, ScopePlatform, Sql } from "../core/storage";

function normalizeBinding(val: unknown): SQLInputValue {
  if (val === null || val === undefined) {
    return null;
  }
  if (typeof val === "number" || typeof val === "string" || typeof val === "bigint") {
    return val;
  }
  if (val instanceof Uint8Array) {
    return val;
  }
  if (val instanceof ArrayBuffer) {
    return new Uint8Array(val);
  }
  if (ArrayBuffer.isView(val)) {
    return new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
  }
  throw new TypeError(`Unsupported SQLite binding value: ${typeof val}`);
}

function normalizeRow<T extends Record<string, SqlStorageValue>>(row: Record<string, unknown>): T {
  const normalized: Record<string, SqlStorageValue> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Uint8Array) {
      normalized[k] = new Uint8Array(v).buffer;
    } else if (typeof v === "string" || typeof v === "number" || v === null) {
      normalized[k] = v;
    } else if (typeof v === "bigint") {
      normalized[k] = Number(v);
    } else if (v instanceof ArrayBuffer) {
      normalized[k] = v;
    } else {
      normalized[k] = null;
    }
  }
  return normalized as T;
}

class NodeSqliteCursor<
  T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
> implements IterableIterator<T> {
  private index = 0;

  constructor(
    private readonly rows: T[],
    private readonly columns: string[],
    readonly rowsRead: number,
    readonly rowsWritten: number,
  ) {}

  toArray(): T[] {
    return [...this.rows];
  }

  one(): T {
    if (this.rows.length !== 1)
      throw new Error(`Expected one SQL row, received ${this.rows.length}`);
    return this.rows[0];
  }

  get columnNames(): string[] {
    return this.columns;
  }

  next(): IteratorResult<T> {
    if (this.index < this.rows.length) {
      return { done: false, value: this.rows[this.index++] };
    }
    return { done: true, value: undefined };
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.rows[Symbol.iterator]();
  }

  raw<U extends SqlStorageValue[]>(): IterableIterator<U> {
    return this.rows.map((row) => Object.values(row) as U)[Symbol.iterator]();
  }
}

function executeQuery<T extends Record<string, SqlStorageValue>>(
  db: DatabaseSync,
  query: string,
  ...bindings: unknown[]
): NodeSqliteCursor<T> {
  const normBindings: SQLInputValue[] = bindings.map(normalizeBinding);
  const trimmed = query.trim();
  const upper = trimmed.toUpperCase();
  const isRead =
    upper.startsWith("SELECT") ||
    upper.startsWith("PRAGMA") ||
    upper.startsWith("WITH") ||
    upper.includes("RETURNING");

  if (!isRead) {
    if (
      normBindings.length === 0 &&
      (trimmed.includes(";") || upper.startsWith("CREATE") || upper.startsWith("DROP"))
    ) {
      db.exec(trimmed);
      return new NodeSqliteCursor<T>([], [], 0, 0);
    }
    const stmt = db.prepare(trimmed);
    const result = stmt.run(...normBindings);
    const changes = typeof result.changes === "number" ? result.changes : Number(result.changes);
    return new NodeSqliteCursor<T>([], [], 0, changes);
  }

  const stmt = db.prepare(trimmed);
  const rawRows = stmt.all(...normBindings) as Record<string, unknown>[];
  const columns = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
  const normalizedRows = rawRows.map((r) => normalizeRow<T>(r));
  return new NodeSqliteCursor<T>(normalizedRows, columns, normalizedRows.length, 0);
}

let spCount = 0;

export function createTestScopePlatform(
  db: DatabaseSync = new DatabaseSync(":memory:"),
): ScopePlatform & {
  db: DatabaseSync;
  alarms: (number | Date)[];
  backgroundWork: Promise<unknown>[];
} {
  const alarms: (number | Date)[] = [];
  const backgroundWork: Promise<unknown>[] = [];

  const sql: Sql = {
    exec: <T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]) => {
      return executeQuery<T>(db, query, ...bindings);
    },
  };

  const transactionSync = <R>(callback: () => R): R => {
    const sp = `sp_${++spCount}`;
    db.exec(`SAVEPOINT ${sp}`);
    try {
      const result = callback();
      db.exec(`RELEASE SAVEPOINT ${sp}`);
      return result;
    } catch (error) {
      db.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
      db.exec(`RELEASE SAVEPOINT ${sp}`);
      throw error;
    }
  };

  const transaction = async <R>(callback: () => Promise<R>): Promise<R> => {
    const sp = `sp_${++spCount}`;
    db.exec(`SAVEPOINT ${sp}`);
    try {
      const result = await callback();
      db.exec(`RELEASE SAVEPOINT ${sp}`);
      return result;
    } catch (error) {
      db.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
      db.exec(`RELEASE SAVEPOINT ${sp}`);
      throw error;
    }
  };

  const storage: AtomicStorage & {
    transaction<T>(callback: () => Promise<T>): Promise<T>;
    setAlarm(time: number | Date): Promise<void>;
  } = {
    sql,
    transactionSync,
    transaction,
    setAlarm: async (time: number | Date) => {
      alarms.push(time);
    },
  };

  return {
    db,
    alarms,
    backgroundWork,
    storage,
    waitUntil: (work: Promise<unknown>) => {
      backgroundWork.push(work);
    },
  };
}
