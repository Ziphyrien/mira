import type { AnswerValue } from "#lib/contracts/research.js";
const prefix = "mira:research:draft:";
export function readDraft(key: string): AnswerValue | undefined {
  try {
    const raw = sessionStorage.getItem(prefix + key);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      value === null ||
      (Array.isArray(value) && value.every((v) => typeof v === "string"))
    )
      return value;
  } catch {
    /* Storage can be disabled by browser policy. */
  }
}
export function saveDraft(key: string, value: AnswerValue) {
  try {
    sessionStorage.setItem(prefix + key, JSON.stringify(value));
  } catch {
    /* Input remains available in memory. */
  }
}
export function clearDraft(key: string) {
  try {
    sessionStorage.removeItem(prefix + key);
  } catch {
    /* Storage may be unavailable. */
  }
}
export function clearDrafts(scope: string) {
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith(prefix + scope + ":")) sessionStorage.removeItem(key);
  } catch {
    /* Storage may be unavailable. */
  }
}
