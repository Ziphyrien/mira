import { RESEARCH_PROTOCOL } from "#lib/contracts/research-protocol.js";
export class ResearchRequestError extends Error {
  constructor(
    message: string,
    readonly reloadRequired = false,
  ) {
    super(message);
  }
}
export async function researchRequest<T>(
  url: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = { "X-Mira-Research-Protocol": RESEARCH_PROTOCOL };
  const init: RequestInit = { method, headers, signal };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ResearchRequestError("连接暂未完成，请重试。");
  }
  if (!response.ok)
    throw new ResearchRequestError(
      result &&
        typeof result === "object" &&
        "message" in result &&
        typeof result.message === "string"
        ? result.message
        : "请求暂未完成，请重试。",
      response.headers.get("X-Mira-Research-Reload") === "1",
    );
  return result as T;
}
