import { assign, fromCallback, setup, type SnapshotFrom } from "xstate";
import type { ChatContext } from "./ports.js";
import type {
  AiModelInfo,
  ChatInput,
  ChatReply,
  Row,
  SearchActivity,
  StreamEvent,
} from "#lib/contracts/index.js";
import {
  consumeChatStream,
  defaultConversationTransport,
  isAbortError,
  type ConversationTransport,
} from "#lib/plugins/conversation/transport.js";

export type CompletedChatReply = ChatReply & { messages: Row[] };

type ChatEvent =
  | { type: "MODEL"; model: AiModelInfo | null }
  | {
      type: "SEND";
      text: string;
      image?: string;
      thinking: ChatInput["thinking"];
      model: ChatInput["model"];
    }
  | {
      type: "REGENERATE";
      prompt: Exclude<ChatInput["prompt"], { kind: "message" }>;
      thinking: ChatInput["thinking"];
      model: ChatInput["model"];
    }
  | { type: "RESUME"; request: ChatInput }
  | { type: "RESTORE_FAILED"; request: ChatInput; message: string }
  | { type: "DELTA"; text: string }
  | { type: "REPLACE"; text: string }
  | { type: "STATUS"; phase: "thinking" | "recall" }
  | { type: "THINKING"; text: string; replace: boolean }
  | { type: "SEARCH"; search: SearchActivity }
  | { type: "STOPPED"; messages: Row[] }
  | ({ type: "DONE" } & CompletedChatReply)
  | { type: "ERROR"; message: string }
  | { type: "RETRY" }
  | { type: "DISMISS" };

/** Converts wire NDJSON StreamEvent payloads into XState ChatEvent transitions. */
function toChatEvent(event: StreamEvent): ChatEvent {
  switch (event.type) {
    case "model":
      return { type: "MODEL", model: event.model };
    case "status":
      return { type: "STATUS", phase: event.phase };
    case "delta":
      return { type: "DELTA", text: event.text };
    case "replace":
      return { type: "REPLACE", text: event.text };
    case "thinking":
      return { type: "THINKING", text: event.text, replace: event.replace };
    case "search":
      return { type: "SEARCH", search: event.search };
    case "stopped":
      return { type: "STOPPED", messages: event.messages };
    case "done":
      return {
        type: "DONE",
        text: event.text,
        thinking: event.thinking,
        searches: event.searches,
        stopped: event.stopped,
        at: event.at,
        replyId: event.replyId,
        userId: event.userId,
        messages: event.messages,
      };
    case "error":
      return { type: "ERROR", message: event.message };
  }
}

/** Creates the NDJSON stream callback actor logic with bounded frame and abort-safe reader cleanup. */
function createStreamActor(transport: ConversationTransport = defaultConversationTransport) {
  return fromCallback<{ type: string }, ChatInput>(({ input, sendBack }) => {
    const controller = new AbortController();
    void consumeChatStream({
      input,
      signal: controller.signal,
      transport,
      onEvent: (event) => {
        sendBack(toChatEvent(event));
      },
    }).catch((error: unknown) => {
      if (!isAbortError(error, controller.signal)) {
        const message =
          error instanceof Error && error.message ? error.message : "发送失败，请稍后再试。";
        sendBack({ type: "ERROR", message });
      }
    });
    return () => controller.abort();
  });
}

const stream = createStreamActor();

export type CreateChatMachineOptions = {
  transport?: ConversationTransport;
  onModel?: (model: AiModelInfo | null) => void;
  onStopped?: (messages: Row[]) => void;
  onDone?: (reply: CompletedChatReply) => void;
};

/** Factory for the chat state machine with configurable transport and narrow lifecycle hooks. */
export function createChatMachine(options: CreateChatMachineOptions = {}) {
  const streamActor = options.transport ? createStreamActor(options.transport) : stream;

  return setup({
    types: {
      context: {} as ChatContext,
      events: {} as ChatEvent,
    },
    actors: { stream: streamActor },
    actions: {
      model: (_context, params: AiModelInfo | null) => {
        options.onModel?.(params);
      },
      stopped: (_context, params: { messages: Row[] }) => {
        options.onStopped?.(params.messages);
      },
      done: (_context, params: CompletedChatReply) => {
        options.onDone?.(params);
      },
    },
  }).createMachine({
    id: "chat",
    initial: "idle",
    context: {
      request: null,
      text: "",
      thinkingText: "",
      searches: [],
      stopped: false,
      phase: "thinking",
      error: "",
    },
    on: {
      DISMISS: {
        target: ".idle",
        actions: assign({ text: "", thinkingText: "", searches: [], error: "", request: null }),
      },
      MODEL: {
        actions: [
          { type: "model", params: ({ event }) => event.model },
          assign(({ context, event }) => {
            const request = context.request;
            const model = event.model;
            if (
              !request ||
              !model ||
              (request.model.provider === model.provider &&
                request.model.modelId === model.modelId &&
                model.thinking.includes(request.thinking))
            ) {
              return {};
            }
            return {
              request: {
                ...request,
                model: { provider: model.provider, modelId: model.modelId },
                thinking: model.thinking.includes("high") ? "high" : model.highest,
              },
            };
          }),
        ],
      },
    },
    states: {
      idle: {
        on: {
          SEND: {
            target: "streaming",
            actions: assign(({ event }) => ({
              request: {
                prompt: {
                  kind: "message",
                  text: event.text,
                  ...(event.image ? { image: event.image } : {}),
                },
                thinking: event.thinking,
                model: { provider: event.model.provider, modelId: event.model.modelId },
                requestId: crypto.randomUUID().replaceAll("-", ""),
              },
              text: "",
              thinkingText: "",
              searches: [],
              stopped: false,
              phase: "thinking" as const,
              error: "",
            })),
          },
          REGENERATE: {
            target: "streaming",
            actions: assign(({ event }) => ({
              request: {
                prompt: event.prompt,
                model: { provider: event.model.provider, modelId: event.model.modelId },
                thinking: event.thinking,
                requestId: crypto.randomUUID().replaceAll("-", ""),
              },
              text: "",
              thinkingText: "",
              searches: [],
              stopped: false,
              phase: "thinking" as const,
              error: "",
            })),
          },
          RESUME: {
            target: "streaming",
            actions: assign(({ event }) => ({
              request: event.request,
              text: "",
              thinkingText: "",
              searches: [],
              stopped: false,
              phase: "thinking" as const,
              error: "",
            })),
          },
          RESTORE_FAILED: {
            target: "failed",
            actions: assign(({ event }) => ({
              request: event.request,
              error: event.message,
              text: "",
              thinkingText: "",
              searches: [],
              stopped: false,
            })),
          },
        },
      },
      streaming: {
        invoke: { src: "stream", input: ({ context }) => context.request! },
        on: {
          DELTA: { actions: assign({ text: ({ context, event }) => context.text + event.text }) },
          REPLACE: { actions: assign({ text: ({ event }) => event.text }) },
          THINKING: {
            actions: assign({
              thinkingText: ({ context, event }) =>
                event.replace ? event.text : context.thinkingText + event.text,
            }),
          },
          SEARCH: {
            actions: assign({
              searches: ({ context, event }) =>
                context.searches.some((search) => search.id === event.search.id)
                  ? context.searches.map((search) =>
                      search.id === event.search.id ? event.search : search,
                    )
                  : [...context.searches, event.search],
            }),
          },
          STOPPED: {
            target: "idle",
            actions: [
              { type: "stopped", params: ({ event }) => ({ messages: event.messages }) },
              assign({
                text: "",
                thinkingText: "",
                searches: [],
                request: null,
                stopped: true,
                error: "",
              }),
            ],
          },
          STATUS: { actions: assign({ phase: ({ event }) => event.phase }) },
          DONE: {
            target: "idle",
            actions: [
              {
                type: "done",
                params: ({ event }) => ({
                  text: event.text,
                  thinking: event.thinking,
                  searches: event.searches,
                  stopped: event.stopped,
                  at: event.at,
                  replyId: event.replyId,
                  userId: event.userId,
                  messages: event.messages,
                }),
              },
              assign({ text: "", thinkingText: "", searches: [], request: null }),
            ],
          },
          ERROR: { target: "failed", actions: assign({ error: ({ event }) => event.message }) },
        },
      },
      failed: {
        on: {
          RETRY: {
            target: "streaming",
            actions: assign(({ context }) => ({
              text: "",
              thinkingText: "",
              searches: [],
              stopped: false,
              phase: "thinking" as const,
              error: "",
              request: context.request,
            })),
          },
        },
      },
    },
  });
}

export type ChatMachineSnapshot = SnapshotFrom<ReturnType<typeof createChatMachine>>;
