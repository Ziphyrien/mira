import { http } from "#lib/app/http.js";
import type { ChatInput, Row, StreamEvent } from "#lib/contracts/index.js";
import { bytes } from "#lib/shared/text.js";

/** Maximum UTF-8 byte length allowed for a single NDJSON line/frame (16 MiB). */
const MAX_NDJSON_FRAME_BYTES = 16 * 1024 * 1024;

type StopInput = Pick<ChatInput, "requestId">;
type CancelChatOutput = { messages?: Row[] };

/** Narrow transport contract for starting and canceling chat turns. */
export type ConversationTransport = {
  stream: (input: ChatInput, signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>;
  cancel: (input: StopInput, signal?: AbortSignal) => Promise<CancelChatOutput>;
};

/** Default production transport backed by /api/chat and /api/chat/cancel. */
export const defaultConversationTransport: ConversationTransport = {
  async stream(input: ChatInput, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? "发送失败，请稍后再试。");
    }
    return res.body;
  },

  async cancel(input: StopInput, signal?: AbortSignal): Promise<CancelChatOutput> {
    return http<CancelChatOutput>("/api/chat/cancel", {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    });
  },
};

function isTerminalStreamEvent(event: StreamEvent): boolean {
  return event.type === "done" || event.type === "error" || event.type === "stopped";
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && error.name === "AbortError";
}

export type ConsumeChatStreamOptions = {
  input: ChatInput;
  signal: AbortSignal;
  transport?: ConversationTransport;
  onEvent: (event: StreamEvent) => void;
};

/**
 * Reads an NDJSON stream with bounded frame protection, split-chunk reassembly,
 * valid unterminated final-line support, terminal detection, and reader release on disposal.
 */
export async function consumeChatStream(options: ConsumeChatStreamOptions): Promise<void> {
  const { input, signal, transport = defaultConversationTransport, onEvent } = options;

  if (signal.aborted) return;

  const body = await transport.stream(input, signal);
  if (signal.aborted) {
    await body.cancel().catch(() => {});
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });

  let buffer = "";
  let ended = false;

  const processLine = (rawLine: string): boolean => {
    if (bytes(rawLine) > MAX_NDJSON_FRAME_BYTES) {
      throw new Error("响应数据帧过大，连接已中断。");
    }
    const trimmed = rawLine.trim();
    if (!trimmed) return false;
    let event: StreamEvent;
    try {
      event = JSON.parse(trimmed) as StreamEvent;
    } catch {
      throw new Error("响应数据格式不正确。");
    }
    if (signal.aborted) return true;
    const terminal = isTerminalStreamEvent(event);
    if (terminal) {
      ended = true;
    }
    onEvent(event);
    return terminal;
  };

  try {
    for (;;) {
      if (signal.aborted) return;
      const { value, done } = await reader.read();
      if (signal.aborted) return;
      if (done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (processLine(line)) {
          return;
        }
      }
      if (bytes(buffer) > MAX_NDJSON_FRAME_BYTES) {
        throw new Error("响应数据帧过大，连接已中断。");
      }
    }

    if (buffer.length > 0 && !signal.aborted) {
      const remainingLines = buffer.split("\n");
      for (const line of remainingLines) {
        if (processLine(line)) {
          return;
        }
      }
    }

    if (!ended && !signal.aborted) {
      onEvent({
        type: "error",
        message: "连接中断了，回复可能仍在生成，稍后刷新看看。",
      });
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
