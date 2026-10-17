import { THINKING, type AiModelInfo } from "#lib/contracts/index.js";
import type { ModelPreferencesSnapshot, ThinkingLevel } from "./ports.js";

export type ModelPreferencesOptions = {
  model: AiModelInfo | null;
  thinking?: ThinkingLevel;
};

const VALID_THINKING_LEVELS: ReadonlySet<ThinkingLevel> = new Set(
  THINKING.map((option) => option.id),
);

/** Picks 'high' when supported by the model; otherwise falls back to the model's highest level. */
function defaultThinkingFor(model: AiModelInfo | null): ThinkingLevel {
  if (!model) return "off";
  if (model.thinking.includes("high")) return "high";
  if (model.thinking.includes(model.highest)) return model.highest;
  return model.thinking[0] ?? "off";
}

function isAllowedThinking(model: AiModelInfo | null, level: ThinkingLevel): boolean {
  if (!VALID_THINKING_LEVELS.has(level)) return false;
  if (!model) return true;
  return model.thinking.includes(level);
}

/**
 * Pure immutable observable controller for selected model info and thinking level.
 * Preserves manual thinking choices across redundant model updates and resets only when
 * provider, modelId, or allowed thinking levels change.
 */
export class ModelPreferences {
  #model: AiModelInfo | null;
  #thinking: ThinkingLevel;
  #disposed = false;
  #subscribers = new Set<(snapshot: ModelPreferencesSnapshot) => void>();
  #snapshot: ModelPreferencesSnapshot;

  constructor({ model, thinking }: ModelPreferencesOptions) {
    this.#model = model;
    this.#thinking =
      thinking && isAllowedThinking(model, thinking) ? thinking : defaultThinkingFor(model);
    this.#snapshot = this.#createSnapshot();
  }

  get snapshot(): ModelPreferencesSnapshot {
    return this.#snapshot;
  }

  subscribe(callback: (snapshot: ModelPreferencesSnapshot) => void): () => void {
    if (this.#disposed) {
      callback(this.#snapshot);
      return () => {};
    }
    this.#subscribers.add(callback);
    callback(this.#snapshot);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  setModel(model: AiModelInfo | null): void {
    if (this.#disposed) return;

    const current = this.#model;
    const sameModelAndAllowed =
      current !== null &&
      model !== null &&
      current.provider === model.provider &&
      current.modelId === model.modelId &&
      model.thinking.includes(this.#thinking);

    let nextThinking = defaultThinkingFor(model);
    if (sameModelAndAllowed || (model === null && current === null)) nextThinking = this.#thinking;

    if (current === model && this.#thinking === nextThinking) return;

    this.#model = model;
    this.#thinking = nextThinking;
    this.#emit();
  }

  setThinking(thinking: ThinkingLevel): boolean {
    if (this.#disposed) return false;
    if (!isAllowedThinking(this.#model, thinking)) return false;
    if (this.#thinking === thinking) return true;
    this.#thinking = thinking;
    this.#emit();
    return true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#subscribers.clear();
  }

  #createSnapshot(): ModelPreferencesSnapshot {
    return Object.freeze({
      model: this.#model,
      thinking: this.#thinking,
    });
  }

  #emit(): void {
    if (this.#disposed) return;
    this.#snapshot = this.#createSnapshot();
    for (const subscriber of this.#subscribers) {
      subscriber(this.#snapshot);
    }
  }
}
