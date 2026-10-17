import { abortable } from "#lib/app/cancellation.js";

/**
 * Shared HTTP client for application services.
 * Handles JSON and binary requests with readable error extraction from backend error responses.
 */
export async function http<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && !(init?.body instanceof Blob)) {
    headers.set("Content-Type", "application/json");
  }
  const signal = init?.signal ?? undefined;
  signal?.throwIfAborted();
  const res = await abortable(fetch(path, { ...init, headers }), signal, (late) => {
    void late.body?.cancel().catch(() => {});
  });
  if (!res.ok) {
    const body = (await abortable(
      res.json().catch(() => null),
      signal,
    )) as { message?: string } | null;
    throw new Error(body?.message ?? `请求失败（${res.status}）`);
  }
  return abortable(res.json() as Promise<T>, signal);
}
