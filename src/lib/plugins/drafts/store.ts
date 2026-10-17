import { createStore, del, get, set } from "idb-keyval";
import { abortable } from "#lib/app/cancellation.js";
import { accountDraftNamespace } from "./namespace.js";
import type { DraftBuffer, DraftSnapshot } from "./ports.js";

const database = createStore("mira-drafts", "drafts");
interface SavedDraft extends DraftSnapshot {
  version: 1;
}

function savedDraft(value: unknown): value is SavedDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<SavedDraft>;
  return (
    draft.version === 1 &&
    typeof draft.text === "string" &&
    (draft.image === null || draft.image instanceof Blob)
  );
}

/** One account per host. Failed storage remains best effort and never rejects into chat. */
export class DurableDraft implements DraftBuffer {
  #snapshot: DraftSnapshot = Object.freeze({ text: "", image: null });
  #subscribers = new Set<(snapshot: DraftSnapshot) => void>();
  #controller = new AbortController();
  #namespace: string | undefined;
  #textEdited = false;
  #imageEdited = false;
  #loaded = false;
  #disposed = false;
  #erased = false;
  #tail = Promise.resolve();
  #ready: Promise<void>;
  #pagehide = () => {
    void this.flush();
  };
  #visibility = () => {
    if (document.visibilityState === "hidden") void this.flush();
  };

  constructor() {
    this.#ready = this.#restore();
    globalThis.window?.addEventListener?.("pagehide", this.#pagehide);
    globalThis.document?.addEventListener?.("visibilitychange", this.#visibility);
  }

  get snapshot() {
    return this.#snapshot;
  }

  subscribe(callback: (snapshot: DraftSnapshot) => void) {
    if (this.#disposed) return () => {};
    this.#subscribers.add(callback);
    callback(this.#snapshot);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  setText(text: string) {
    if (this.#disposed || this.#erased) return;
    this.#textEdited = true;
    this.#replace({ ...this.#snapshot, text });
    this.#save();
  }

  setImage(image: Blob | null) {
    if (this.#disposed || this.#erased) return;
    this.#imageEdited = true;
    this.#replace({ ...this.#snapshot, image });
    this.#save();
  }

  async flush(): Promise<void> {
    await this.#ready;
    await this.#tail;
  }

  /** Delete-all seals this host so late preparation/edits cannot recreate the deleted draft. */
  async clear(): Promise<void> {
    if (this.#disposed) return;
    this.#erased = true;
    this.#textEdited = this.#imageEdited = true;
    this.#replace({ text: "", image: null });
    await this.#ready;
    this.#save();
    await this.#tail;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#save();
    this.#disposed = true;
    this.#controller.abort();
    globalThis.window?.removeEventListener?.("pagehide", this.#pagehide);
    globalThis.document?.removeEventListener?.("visibilitychange", this.#visibility);
    this.#subscribers.clear();
    await this.flush();
  }

  async #restore() {
    const signal = AbortSignal.any([this.#controller.signal, AbortSignal.timeout(5000)]);
    try {
      this.#namespace = await accountDraftNamespace(signal);
      const value: unknown = await abortable(get(this.#namespace, database), signal);
      if (this.#disposed) return;
      this.#loaded = true;
      if (savedDraft(value) && !this.#erased) {
        this.#replace({
          text: this.#textEdited ? this.#snapshot.text : value.text,
          image: this.#imageEdited ? this.#snapshot.image : value.image,
        });
      }
    } catch {
      // Authentication, IndexedDB denial, quota, and corrupt records must not disable chat.
    } finally {
      if (this.#textEdited || this.#imageEdited) this.#save();
    }
  }

  #replace(snapshot: DraftSnapshot) {
    this.#snapshot = Object.freeze(snapshot);
    for (const callback of this.#subscribers) callback(this.#snapshot);
  }

  #save() {
    // A failed read must not overwrite unseen fields. Explicit deletion is still allowed.
    if (!this.#namespace || (!this.#loaded && !this.#erased)) return;
    const namespace = this.#namespace;
    const snapshot = this.#snapshot;
    const erase = this.#erased || (!snapshot.text && !snapshot.image);
    // Capture values at enqueue time. A late put can never overtake a later clear.
    this.#tail = this.#tail
      .then(() =>
        erase
          ? del(namespace, database)
          : set(namespace, { version: 1, ...snapshot } satisfies SavedDraft, database),
      )
      .catch(() => {});
  }
}
