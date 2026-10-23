import { createStore, keys, update } from "idb-keyval";
import { abortable } from "#lib/app/cancellation.js";
import type { AnswerValue } from "#lib/contracts/research.js";

const database = createStore("mira-research-drafts", "drafts");
const legacyPrefix = "mira:research:draft:";
type RecordData = { schema: 1; context: string; generation: string; data: unknown };
let tail: Promise<unknown> = Promise.resolve();
const active = new Set<{ key: string; seal(): void }>();
function ordered<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work);
  tail = result.catch(() => {});
  return result;
}
function bounded<T>(work: Promise<T>) {
  return abortable(work, AbortSignal.timeout(5000));
}
function record(value: unknown): value is RecordData {
  return (
    typeof value === "object" &&
    value !== null &&
    "schema" in value &&
    value.schema === 1 &&
    "context" in value &&
    typeof value.context === "string" &&
    "generation" in value &&
    typeof value.generation === "string" &&
    "data" in value
  );
}
function empty(context = ""): RecordData {
  return { schema: 1, context, generation: crypto.randomUUID(), data: undefined };
}
/** Validate draft structure while retaining incomplete form fields; saving still uses the domain schema. */
function matchesDraft(value: unknown, initial: unknown): boolean {
  if (initial === undefined || initial === null)
    return (
      value === undefined ||
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      Array.isArray(value) ||
      typeof value === "object"
    );
  if (typeof initial === "number")
    return value === undefined || (typeof value === "number" && Number.isFinite(value));
  if (Array.isArray(initial))
    return (
      Array.isArray(value) &&
      value.every((item) => !initial.length || matchesDraft(item, initial[0]))
    );
  if (typeof initial === "object")
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.entries(initial).every(([key, sample]) =>
        matchesDraft((value as Record<string, unknown>)[key], sample),
      )
    );
  return typeof value === typeof initial;
}
export type DraftOptions<T extends Record<string, unknown>> = {
  scope: string;
  name: string;
  context?: string;
  initial: T;
  restore: (value: T) => void;
  legacy?: () => { key: string; data: T } | undefined;
};
export class ResearchDraft<T extends Record<string, unknown>> {
  readonly key: string;
  private snapshot: T;
  private dirty = new Set<keyof T>();
  private generation?: string;
  private disposed = false;
  private erased = false;
  private legacy?: { key: string; data: T };
  private pending: Promise<unknown> = Promise.resolve();
  private readonly ready: Promise<void>;
  constructor(private readonly options: DraftOptions<T>) {
    this.key = options.scope + "/" + options.name;
    this.snapshot = structuredClone(options.initial);
    this.legacy = options.legacy?.();
    active.add(this);
    this.ready = this.load();
  }
  private async load() {
    let saved: RecordData | undefined;
    try {
      await ordered(() =>
        bounded(
          update<unknown>(
            this.key,
            (current) => {
              saved =
                record(current) && current.context === (this.options.context ?? "")
                  ? current
                  : empty(this.options.context);
              if (saved.data === undefined && this.legacy)
                saved = { ...saved, data: this.legacy.data };
              return saved;
            },
            database,
          ),
        ),
      );
      if (!saved) return;
      this.generation = saved.generation;
      this.restore(saved.data);
      this.removeLegacy();
    } catch {
      if (this.legacy) this.restore(this.legacy.data);
    }
  }
  private restore(value: unknown) {
    if (this.erased || !matchesDraft(value, this.options.initial)) return;
    const restored = structuredClone(value as T);
    for (const key of this.dirty) restored[key] = this.snapshot[key];
    this.snapshot = restored;
    if (!this.disposed) this.options.restore(structuredClone(restored));
  }
  update(value: T) {
    if (this.disposed || this.erased) return;
    const patch: Partial<T> = {};
    let changed = false;
    for (const key of Object.keys(value) as (keyof T)[]) {
      if (JSON.stringify(value[key]) === JSON.stringify(this.snapshot[key])) continue;
      patch[key] = structuredClone(value[key]);
      this.dirty.add(key);
      changed = true;
    }
    if (!changed) return;
    this.snapshot = structuredClone(value);
    this.pending = ordered(async () => {
      await this.ready;
      if (this.erased || !this.generation) return;
      await bounded(
        update<unknown>(
          this.key,
          (current) =>
            record(current) && current.generation === this.generation
              ? { ...current, data: { ...((current.data as T) ?? this.options.initial), ...patch } }
              : current,
          database,
        ),
      );
    }).catch(() => {});
  }
  seal() {
    this.erased = true;
    this.removeLegacy();
  }
  private removeLegacy() {
    if (this.legacy)
      try {
        sessionStorage.removeItem(legacyPrefix + this.legacy.key);
      } catch {
        /* Browser storage may be unavailable. */
      }
  }
  async flush() {
    await this.ready;
    await this.pending;
  }
  clear() {
    this.seal();
    return clearDraft(this.key);
  }
  dispose() {
    this.disposed = true;
    active.delete(this);
  }
}
export function clearDraft(key: string) {
  for (const draft of active) if (draft.key === key) draft.seal();
  return ordered(() => bounded(update(key, () => empty(), database))).catch(() => {});
}
export function clearDrafts(scope: string, legacyScope?: string) {
  const prefix = scope + "/";
  for (const draft of active) if (draft.key.startsWith(prefix)) draft.seal();
  if (legacyScope)
    try {
      for (const key of Object.keys(sessionStorage))
        if (key.startsWith(legacyPrefix + legacyScope + ":")) sessionStorage.removeItem(key);
    } catch {
      /* IndexedDB cleanup remains independent. */
    }
  return ordered(async () => {
    for (const key of await bounded(keys(database)))
      if (typeof key === "string" && key.startsWith(prefix))
        await bounded(update(key, () => empty(), database));
  }).catch(() => {});
}
export function legacyAnswer(key: string) {
  try {
    const raw = sessionStorage.getItem(legacyPrefix + key);
    if (raw === null) return;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value)) ||
      value === null ||
      (Array.isArray(value) && value.every((v) => typeof v === "string"))
    )
      return { key, data: { value: value as AnswerValue } };
  } catch {
    /* A fresh draft remains usable. */
  }
}
export function participantDraftScope(studyId: string, participation: string) {
  return "study:" + studyId + "/participant:" + participation;
}
