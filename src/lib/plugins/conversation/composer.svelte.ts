import type { ComposerPort } from "./ports.js";
import type { DraftBuffer } from "#lib/plugins/drafts/ports.js";
import { untrack } from "svelte";

export const MAX_DRAFT_LENGTH = 4000;

type DictationEdit = { before: string; start: number; end: number };

export class ComposerState implements ComposerPort {
  #draft = $state("");
  #error = $state("");
  #selection = $state.raw({ start: 0, end: 0 });
  #focusRequest = $state(0);
  #dictation = $state.raw<DictationEdit>();
  #disposed = false;
  #revision = 0;
  #buffer?: DraftBuffer;
  #unsubscribe?: () => void;
  constructor(buffer?: DraftBuffer) {
    this.#buffer = buffer;
    this.#unsubscribe = buffer?.subscribe(({ text }) => {
      if (text !== this.#draft) {
        this.#dictation = undefined;
        this.#draft = text.slice(0, MAX_DRAFT_LENGTH);
        this.#selection = { start: this.#draft.length, end: this.#draft.length };
        this.#revision++;
      }
    });
  }
  get revision() { return this.#revision; }
  get draft() { return this.#draft; }
  get error() { return this.#error; }
  get selection() { return this.#selection; }
  get focusRequest() { return this.#focusRequest; }
  get composing() { return this.#dictation !== undefined; }
  select(start: number, end: number) {
    if (this.#disposed || this.#dictation) return;
    start = Math.max(0, Math.min(start, this.#draft.length));
    this.#selection = { start, end: Math.max(start, Math.min(end, this.#draft.length)) };
  }
  setDraft(text: string) {
    if (this.#disposed) return;
    this.#dictation = undefined;
    this.#revision++;
    this.#draft = text.slice(0, MAX_DRAFT_LENGTH);
    this.#selection = { start: this.#draft.length, end: this.#draft.length };
    this.#buffer?.setText(this.#draft);
  }
  beginDictation() {
    if (this.#disposed || this.#dictation) return false;
    this.#dictation = { before: this.#draft, ...this.#selection };
    return true;
  }
  previewDictation(text: string) {
    const edit = this.#dictation;
    if (this.#disposed || !edit) return "草稿已发生变化，请重新开始语音输入。";
    const next = edit.before.slice(0, edit.start) + text + edit.before.slice(edit.end);
    if (next.length > MAX_DRAFT_LENGTH) return "输入内容已满，请先发送或缩短草稿。";
    this.#revision++;
    this.#draft = next;
    this.#selection = { start: edit.start, end: edit.start + text.length };
    return "";
  }
  finishDictation(commit: boolean) {
    const edit = this.#dictation;
    if (this.#disposed || !edit) return;
    this.#dictation = undefined;
    if (!commit) {
      this.#draft = edit.before;
      this.#selection = { start: edit.start, end: edit.end };
    } else {
      this.#selection = { start: this.#selection.end, end: this.#selection.end };
      this.#buffer?.setText(this.#draft);
    }
    this.#revision++;
    this.#focusRequest++;
  }
  clearSent(text: string, revision = this.#revision) {
    if (!this.#disposed && this.#draft === text && this.#revision === revision) this.setDraft("");
  }
  clearError() { if (!this.#disposed) this.#error = ""; }
  run(work: Promise<unknown>) {
    void work.catch((error: unknown) => {
      if (!this.#disposed) this.#error = error instanceof Error ? error.message : "请求失败，请重试。";
    });
  }
  dispose() {
    this.#unsubscribe?.();
    untrack(() => this.finishDictation(false));
    this.#disposed = true;
  }
}
