import { http } from "#lib/app/http.js";
import { normalizeKey } from "#lib/shared/identity.js";

/** Keep normalization aligned with the account key format; never retain the credential. */
export async function accountDraftNamespace(signal: AbortSignal): Promise<string> {
  const { key } = await http<{ key: string }>("/api/key", { signal });
  const normalized = normalizeKey(key);
  if (!normalized) throw new Error("Invalid account identity");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  signal.throwIfAborted();
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
