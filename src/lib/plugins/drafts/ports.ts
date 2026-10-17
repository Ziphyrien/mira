export interface DraftSnapshot {
  readonly text: string;
  readonly image: Blob | null;
}

/** Synchronous edits are queued immediately; only structured-cloneable data is persisted. */
export interface DraftBuffer {
  readonly snapshot: DraftSnapshot;
  subscribe(callback: (snapshot: DraftSnapshot) => void): () => void;
  setText(text: string): void;
  setImage(image: Blob | null): void;
}
