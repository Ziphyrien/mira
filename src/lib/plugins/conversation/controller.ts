import { abortable, requestSignal } from "#lib/app/cancellation.js";
import { createActor, type ActorRefFrom, type Subscription } from "xstate";
import type { ConversationSnapshot } from "./ports.js";
import type { AiModelInfo, ChatInput, Row, SpaceState } from "#lib/contracts/index.js";
import {
  defaultConversationTransport,
  isAbortError,
  type ConversationTransport,
} from "#lib/plugins/conversation/transport.js";
import {
  createChatMachine,
  type ChatMachineSnapshot,
  type CompletedChatReply,
} from "#lib/plugins/conversation/machine.js";

type ConversationCallbacks = {
  onModel?: (model: AiModelInfo | null) => void;
  onMessages?: (rows: Row[]) => void;
  onDone?: (reply: CompletedChatReply) => void;
};

export type ConversationControllerOptions = ConversationCallbacks & {
  transport?: ConversationTransport;
  signal?: AbortSignal;
  serverBusy?: boolean;
};

export type ConversationSendInput = {
  text: string;
  image?: string;
  thinking: ChatInput["thinking"];
  model: ChatInput["model"];
};

export type ConversationRegenerateInput = {
  prompt: Exclude<ChatInput["prompt"], { kind: "message" }>;
  thinking: ChatInput["thinking"];
  model: ChatInput["model"];
};

const noop = () => {};

/**
 * Pure TypeScript observable controller owning chat request execution and cancellation.
 * Starts idle with zero I/O; explicit commands (`send`, `regenerate`, `resume`) initiate streams.
 */
export class ConversationController {
  #transport: ConversationTransport;
  #onModel: (model: AiModelInfo | null) => void;
  #onMessages: (rows: Row[]) => void;
  #onDone: (reply: CompletedChatReply) => void;

  #actor: ActorRefFrom<ReturnType<typeof createChatMachine>>;
  #actorSub: Subscription;
  #machineSnapshot: ChatMachineSnapshot;

  #serverBusy = false;
  #stopping = false;
  #stopError: string | null = null;
  #stopController: AbortController | null = null;
  #stopRequestId: string | null = null;
  #stopTask: Promise<void> | null = null;
  #disposed = false;
  #signal?: AbortSignal;
  #abort = () => this.dispose();

  #subscribers = new Set<(snapshot: ConversationSnapshot) => void>();
  #snapshot: ConversationSnapshot;

  constructor(options: ConversationControllerOptions = {}) {
    this.#transport = options.transport ?? defaultConversationTransport;
    this.#onModel = options.onModel ?? noop;
    this.#onMessages = options.onMessages ?? noop;
    this.#onDone = options.onDone ?? noop;
    this.#serverBusy = Boolean(options.serverBusy);

    const machine = createChatMachine({
      transport: this.#transport,
      onModel: (model) => {
        if (!this.#disposed) this.#onModel(model);
      },
      onStopped: (rows) => {
        if (!this.#disposed) this.#onMessages(rows);
      },
      onDone: (reply) => {
        if (!this.#disposed) {
          this.#onMessages(reply.messages);
          this.#onDone(reply);
        }
      },
    });

    this.#actor = createActor(machine);
    this.#machineSnapshot = this.#actor.getSnapshot();
    this.#snapshot = this.#createSnapshot();

    this.#actorSub = this.#actor.subscribe((nextMachineSnapshot) => {
      if (this.#disposed) return;
      this.#machineSnapshot = nextMachineSnapshot;
      const activeRequestId = nextMachineSnapshot.context.request?.requestId ?? null;
      if (this.#stopRequestId && activeRequestId !== this.#stopRequestId) {
        this.#abortPendingStop();
      }
      if (!nextMachineSnapshot.matches("streaming") && activeRequestId === null) {
        this.#serverBusy = false;
      }
      this.#emit();
    });

    this.#actor.start();
    this.#signal = options.signal;
    if (this.#signal?.aborted) this.dispose();
    else this.#signal?.addEventListener("abort", this.#abort, { once: true });
  }

  get snapshot(): ConversationSnapshot {
    return this.#snapshot;
  }

  subscribe(callback: (snapshot: ConversationSnapshot) => void): () => void {
    if (this.#disposed) {
      callback(this.#snapshot);
      return noop;
    }
    this.#subscribers.add(callback);
    callback(this.#snapshot);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  send(input: ConversationSendInput): void {
    if (this.#disposed) return;
    this.#clearStopState();
    this.#actor.send({
      type: "SEND",
      text: input.text,
      ...(input.image ? { image: input.image } : {}),
      thinking: input.thinking,
      model: input.model,
    });
  }

  regenerate(input: ConversationRegenerateInput): void {
    if (this.#disposed) return;
    this.#clearStopState();
    this.#actor.send({
      type: "REGENERATE",
      prompt: input.prompt,
      thinking: input.thinking,
      model: input.model,
    });
  }

  resume(request: ChatInput): void {
    if (this.#disposed) return;
    this.#clearStopState();
    this.#actor.send({ type: "RESUME", request });
  }

  restoreFailed(request: ChatInput, message: string): void {
    if (this.#disposed) return;
    this.#clearStopState();
    this.#actor.send({ type: "RESTORE_FAILED", request, message });
  }

  retry(): void {
    if (this.#disposed) return;
    this.#clearStopState();
    this.#actor.send({ type: "RETRY" });
  }

  dismiss(): void {
    if (this.#disposed) return;
    this.#clearStopState();
    this.#serverBusy = false;
    this.#actor.send({ type: "DISMISS" });
  }

  reconcile(state: Pick<Extract<SpaceState, { profile: object }>, "busy" | "generation">): void {
    if (this.#disposed) return;
    this.dismiss();
    this.setServerBusy(state.busy);
    const pending = state.generation;
    if (pending?.status === "running") this.resume(pending.input);
    else if (pending?.status === "failed")
      this.restoreFailed(pending.input, pending.error ?? "这次没有顺利回复，请再试一次。");
  }

  setServerBusy(busy: boolean): void {
    if (this.#disposed) return;
    const next = Boolean(busy);
    if (this.#serverBusy === next) return;
    this.#serverBusy = next;
    this.#emit();
  }

  stop(caller?: AbortSignal): Promise<void> {
    if (this.#disposed || caller?.aborted) return Promise.resolve();
    const requestId = this.#machineSnapshot.context.request?.requestId;
    if (!requestId || !this.#machineSnapshot.matches("streaming")) {
      return Promise.resolve();
    }
    if (this.#stopping && this.#stopRequestId === requestId && this.#stopTask) {
      return abortable(this.#stopTask, caller);
    }

    this.#abortPendingStop();
    const controller = new AbortController();
    const signal = requestSignal(controller.signal, caller);
    this.#stopController = controller;
    this.#stopRequestId = requestId;
    this.#stopping = true;
    this.#stopError = null;
    this.#emit();

    const task = (async () => {
      try {
        const result = await abortable(this.#transport.cancel({ requestId }, signal), signal);
        if (this.#disposed || signal.aborted) return;
        const currentRequestId = this.#actor.getSnapshot().context.request?.requestId;
        if (currentRequestId === requestId) {
          this.#actor.send({ type: "STOPPED", messages: result?.messages ?? [] });
        }
      } catch (error) {
        if (this.#disposed || isAbortError(error, signal)) return;
        const currentRequestId = this.#actor.getSnapshot().context.request?.requestId;
        if (currentRequestId === requestId) {
          this.#stopError =
            error instanceof Error && error.message ? error.message : "停止生成失败，请稍后再试。";
        }
      } finally {
        if (!this.#disposed && this.#stopController === controller) {
          this.#stopController = null;
          this.#stopRequestId = null;
          this.#stopTask = null;
          this.#stopping = false;
          this.#emit();
        }
      }
    })();

    this.#stopTask = task;
    return task;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#signal?.removeEventListener("abort", this.#abort);
    this.#abortPendingStop();
    this.#stopping = false;
    this.#actorSub.unsubscribe();
    this.#actor.stop();
    this.#machineSnapshot = this.#actor.getSnapshot();
    this.#snapshot = this.#createSnapshot();
    this.#subscribers.clear();
  }

  #abortPendingStop(): void {
    if (this.#stopController) {
      this.#stopController.abort();
      this.#stopController = null;
    }
    this.#stopRequestId = null;
    this.#stopTask = null;
    this.#stopping = false;
  }

  #clearStopState(): void {
    this.#abortPendingStop();
    this.#stopError = null;
  }

  #createSnapshot(): ConversationSnapshot {
    const machine = this.#machineSnapshot;
    return Object.freeze({
      context: machine.context,
      matches: machine.matches.bind(machine),
      serverBusy: this.#serverBusy,
      stopping: this.#stopping,
      stopError: this.#stopError,
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
