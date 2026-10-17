import type { ChatInput, ChatReply, StreamEvent, Profile } from "../../../src/lib/contracts";
import { IMAGE_ONLY_TEXT } from "../../../src/lib/shared/images";
import type { SpaceScope } from "../../core/storage";
import type { PromptPlanner } from "../prompts/api";
import type { TurnGeneration } from "../generation/ports";
import type { TurnMemory, MemoryMaintenance } from "../memory/ports";
import type { TurnImages } from "../images/ports";
import { ModelSelectionError, type ChatModels } from "../models/api";
import type { AccountIdentityPort } from "../account/api";
import type { HistoryReader } from "../history/ports";
import type { Transcript } from "./transcript";
import type { Operation, OperationStore } from "./ports";

/** One request lifecycle owns admission, recovery and completion ordering. */
export class OperationCoordinator {
  private admitting: Promise<void> = Promise.resolve();
  private completing: Promise<void> = Promise.resolve();
  private started = false;
  constructor(
    private readonly scope: SpaceScope,
    private readonly generation: TurnGeneration,
    private readonly memory: TurnMemory & MemoryMaintenance,
    private readonly models: ChatModels,
    private readonly prompts: PromptPlanner,
    private readonly profile: () => Promise<Profile | null>,
    private readonly images: TurnImages,
    private readonly journal: OperationStore,
    private readonly history: HistoryReader,
    private readonly transcript: Pick<Transcript, "sync" | "close">,
    private readonly usage: { touch(): Promise<void> },
    private readonly identity: Pick<AccountIdentityPort, "uid">,
  ) {}
  private waitUntil(work: Promise<unknown>) {
    this.scope.background(work, "conversation.work");
  }
  resume() {
    return this.start();
  }
  async run(input: ChatInput, send: (event: StreamEvent) => Promise<void>, signal: AbortSignal) {
    const previous = this.journal.read(input.requestId);
    if (previous && JSON.stringify(previous.input.prompt) !== JSON.stringify(input.prompt))
      throw new Error("Request ID belongs to another message");
    await this.turn(input, send, signal);
  }
  private async prepareOperation(operation: Operation) {
    if (!operation.prompt) {
      const config = await this.scope.directory.aiConfiguration();
      operation.prompt = await this.prompts.create({
        purpose: "turn",
        models: { ...config, chat: operation.input.model },
        thinking: operation.input.thinking,
      });
      this.journal.save(operation);
    }
    if (operation.rewindTo !== undefined && !operation.prepared) {
      await this.memory.rewind(operation.rewindTo, operation.attemptId, () => {
        this.journal.truncate(operation.rewindTo!, operation.input.requestId);
        this.journal.save({ ...operation, prepared: true });
      });
      operation.prepared = true;
    }
    this.memory.freeze(operation.view);
    const reset = this.journal.turn() !== operation.attemptId;
    await this.generation.prepare({
      model: operation.input.model,
      thinking: operation.input.thinking,
      sessionId: operation.prompt.sessionId,
      reset,
    });
    if (reset) this.journal.prepared(operation.attemptId);
  }
  private finishOperation(operation: Operation, answered: boolean): Promise<ChatReply | undefined> {
    const lifecycle = this.scope.alive;
    const work = this.completing.then(async () => {
      const id = operation.input.requestId,
        cached = this.journal.reply(id);
      if (cached) return cached;
      const currentOperation = () => {
        if (lifecycle !== this.scope.alive) return undefined;
        const current = this.journal.read(id);
        if (
          current?.attemptId !== operation.attemptId ||
          current.status === "cancelled" ||
          current.status === "superseded"
        )
          return undefined;
        return current;
      };
      if (!currentOperation()) return undefined;
      await this.transcript.sync();
      const answer = await this.generation.answer();
      let current = currentOperation();
      if (!current) return undefined;
      let stopped = current.stopRequested === true || this.journal.isCancelled(id);
      let partial = current.partial;
      const complete = !stopped && answered && answer.complete && Boolean(answer.text);
      if (!complete) {
        await this.memory.rewind(operation.userId + 1, `${operation.attemptId}:failed`, () => {
          if (!currentOperation()) throw new Error("Operation was replaced");
          this.journal.truncate(operation.userId + 1, id);
        });
        current = currentOperation();
        if (!current) return undefined;
        stopped = current.stopRequested === true || this.journal.isCancelled(id);
        partial = current.partial;
      }
      let done: ChatReply | undefined;
      const finalOperation = current;
      let status: Operation["status"] = "failed";
      if (stopped) status = "cancelled";
      else if (complete) status = "done";
      const commit = () => {
        if (complete || (stopped && partial?.text)) {
          const row = this.memory.history(undefined, 1)[0];
          if (row?.kind !== "mira") throw new Error("Final assistant message was not recorded");
          const thinking = stopped ? partial!.thinking : answer.thinking;
          const searches = this.journal.searches(operation.attemptId);
          done = {
            text: stopped ? partial!.text : answer.text,
            ...(thinking ? { thinking } : {}),
            ...(searches.length ? { searches } : {}),
            ...(stopped ? { stopped: true as const } : {}),
            at: row.at,
            replyId: row.i,
            userId: operation.userId,
          };
        }
        this.journal.complete(
          {
            ...finalOperation,
            status,
            ...(!complete && !stopped ? { error: "这次没有顺利回复，请再试一次。" } : {}),
          },
          done,
        );
      };
      if (stopped && partial?.text)
        this.memory.record(
          `stop:${operation.attemptId}`,
          [{ kind: "mira", text: partial.text, date: partial.at }],
          commit,
        );
      else this.scope.storage.transactionSync(commit);
      if (!(await this.busy())) this.memory.freeze(undefined);
      await this.usage.touch();
      if (this.memory.working()) this.scope.wake();
      return done;
    });
    this.completing = work.then(
      () => {},
      () => {},
    );
    return work;
  }
  private deadline() {
    return setTimeout(
      () =>
        this.waitUntil(
          this.generation.abort().catch((error: unknown) => console.error("turn.timeout", error)),
        ),
      300_000,
    );
  }
  /** Reacquire the durable submission before releasing recovered work to the scheduler. */
  private async start() {
    if (this.started) return;
    if (!this.journal.active() && !(await this.busy())) {
      this.started = true;
      this.generation.resume();
      return;
    }
    const timer = this.deadline();
    const operation = this.journal.active();
    if (operation) await this.prepareOperation(operation);
    const submission = operation
      ? await this.generation.submit(operation.text, operation.attemptId)
      : undefined;
    this.started = true;
    this.generation.resume();
    if (
      operation &&
      (operation.stopRequested || this.journal.isCancelled(operation.input.requestId))
    )
      this.waitUntil(
        this.generation.abort().catch((error: unknown) => console.error("turn.stop.resume", error)),
      );
    this.waitUntil(
      (submission
        ? submission.wait().then((answered) => this.finishOperation(operation!, answered))
        : this.generation.idle().then(() => this.transcript.sync())
      )
        .catch((error: unknown) => console.error("turn.resume", error))
        .finally(() => clearTimeout(timer)),
    );
  }
  async busy(): Promise<boolean> {
    return (await this.generation.live()).busy;
  }
  async stop(requestId: string): Promise<void> {
    this.journal.cancel(requestId);
    if (!this.identity.uid()) throw new Error("Space is not configured");
    await this.start();
    const live = await this.generation.live();
    const operation = this.journal.active();
    if (!operation || operation.input.requestId !== requestId || operation.status !== "running")
      return;
    const partial = live.message ? { ...live.message, at: Date.now() } : undefined;
    const stopping = {
      ...operation,
      stopRequested: true as const,
      ...(partial ? { partial } : {}),
    };
    this.journal.save(stopping);
    await this.generation.abort();
    await this.finishOperation(stopping, false);
  }
  prepareImport(): Promise<boolean> {
    const ready = this.admitting.then(async () => {
      await this.completing;
      if ((await this.busy()) || this.journal.active()) return false;
      await this.transcript.sync();
      return true;
    });
    this.admitting = ready.then(
      () => {},
      () => {},
    );
    return ready;
  }
  /** Stable logical requests own Pi attempts; reconnects never insert a second input. */
  private admit(input: ChatInput, send: (event: StreamEvent) => Promise<void>) {
    const { requestId, thinking, model: requested } = input;
    const lifecycle = this.scope.alive;
    const admission = this.admitting.then(async () => {
      if (lifecycle !== this.scope.alive) throw new Error("Space was cleared");
      if (this.journal.isCancelled(requestId)) return { cancelled: true as const };
      const cached = this.journal.reply(requestId);
      if (cached) return { cached };
      const existing = this.journal.read(requestId);
      if (existing?.status === "superseded")
        throw new ModelSelectionError("这条回复已被替换，请刷新页面查看当前对话。");
      if (existing && JSON.stringify(existing.input.prompt) !== JSON.stringify(input.prompt))
        throw new Error("Request ID belongs to another message");
      if (existing?.status === "running") {
        await this.start();
        const submission = await this.generation.submit(existing.text, existing.attemptId);
        return { operation: existing, submission, timer: undefined };
      }
      await this.transcript.sync();
      if (!(await this.profile())) throw new Error("Profile is not configured");
      const attemptId = crypto.randomUUID();
      const timer = this.deadline(),
        expires = Date.now() + 300_000;
      let operation: Operation | undefined;
      try {
        const config = await this.scope.directory.aiConfiguration();
        const info = this.models.select(config);
        void send({ type: "model", model: info });
        if (!info) throw new ModelSelectionError("暂时无法对话，请稍后再试。");
        if (requested.provider !== info.provider || requested.modelId !== info.modelId)
          throw new ModelSelectionError("模型已更新，请重试。");
        if (!info.thinking.includes(thinking))
          throw new ModelSelectionError("当前模型不支持这个思考档位，请重新选择。");
        await this.completing;
        if ((await this.busy()) || this.journal.active())
          throw new Error("An accepted reply is still running");
        if (!existing && input.prompt.kind === "message" && !(await this.memory.prepare(120_000)))
          throw new Error("记忆摘要暂未准备好，请稍后重试。");
        if (lifecycle !== this.scope.alive || Date.now() >= expires)
          throw new Error("Admission expired");
        if (this.journal.isCancelled(requestId)) {
          clearTimeout(timer);
          return { cancelled: true as const };
        }
        if (input.prompt.kind === "message" && input.prompt.image && !info.supportsImages)
          throw new ModelSelectionError("当前日常模型不支持图片，请切换到支持读图的模型。");
        if (!existing && input.prompt.kind === "message" && input.prompt.image) {
          const previous = this.memory.input(`input:${requestId}`);
          if (
            !this.images.pending(input.prompt.image) &&
            (!previous || this.images.forUser(previous.i)?.id !== input.prompt.image)
          )
            throw new ModelSelectionError("图片已失效，请重新选择图片。");
        }
        const prompt = await this.prompts.create({ purpose: "turn", models: config, thinking });
        if (lifecycle !== this.scope.alive || Date.now() >= expires)
          throw new Error("Admission expired");
        const beforeView = this.memory.render();
        const source = `input:${requestId}`;
        const newInput = input.prompt.kind === "message" && !this.memory.input(source);
        const admitted: { operation?: Operation } = {};
        const commitAdmission = () => {
          let question;
          if (input.prompt.kind === "message") question = this.memory.input(source);
          else if (input.prompt.kind === "question")
            question = this.memory.user(input.prompt.userId);
          else {
            const replyTo = this.journal.replyTo(input.prompt.replyId);
            question = replyTo === undefined ? undefined : this.memory.user(replyTo);
          }
          if (!question) throw new Error("Original user message was not found");
          if (this.images.forUser(question.i) && !info.supportsImages)
            throw new ModelSelectionError("原消息包含图片，当前日常模型不支持读图。");
          if (input.prompt.kind === "message" && input.prompt.image)
            this.images.attach(input.prompt.image, question.i);
          const candidate: Operation = {
            input,
            prompt,
            attemptId,
            userId: question.i,
            text: question.text,
            view: existing?.view ?? (newInput ? beforeView : this.memory.renderBefore(question.i)),
            status: "running",
            ...(existing || input.prompt.kind !== "message" ? { rewindTo: question.i + 1 } : {}),
          };
          this.journal.begin(candidate);
          admitted.operation = candidate;
        };
        if (input.prompt.kind === "message")
          this.memory.record(
            source,
            [
              {
                kind: "user",
                text: input.prompt.text || IMAGE_ONLY_TEXT,
                image: input.prompt.image,
              },
            ],
            commitAdmission,
          );
        else this.scope.storage.transactionSync(commitAdmission);
        operation = admitted.operation;
        if (!operation) throw new Error("Operation was not admitted");
        await this.prepareOperation(operation);
        if (this.journal.isCancelled(requestId)) {
          clearTimeout(timer);
          await this.finishOperation(operation, false);
          return { cancelled: true as const };
        }
        const submission = await this.generation.submit(operation.text, attemptId);
        this.started = true;
        this.generation.resume();
        this.scope.wake();
        return { operation, submission, timer };
      } catch (error) {
        if (operation)
          this.journal.complete({
            ...operation,
            status: "failed",
            error: "这次没有顺利回复，请再试一次。",
          });
        clearTimeout(timer);
        throw error;
      }
    });
    this.admitting = admission.then(
      () => {},
      () => {},
    );
    return admission;
  }
  private async turn(
    input: ChatInput,
    send: (event: StreamEvent) => Promise<void>,
    signal: AbortSignal,
  ) {
    const { requestId } = input;
    const lifecycle = this.scope.alive,
      cached = this.journal.reply(requestId);
    if (cached) {
      await send({ type: "done", ...cached, messages: this.history.rows(undefined, 80) });
      return;
    }
    void send({ type: "status", phase: "thinking" });
    const admission = await this.admit(input, send);
    if (admission.cancelled) {
      await send({ type: "stopped", messages: this.history.rows(undefined, 80) });
      return;
    }
    if (admission.cached) {
      await send({ type: "done", ...admission.cached, messages: this.history.rows(undefined, 80) });
      return;
    }
    let done: ChatReply | undefined;
    try {
      const watch = signal.aborted ? undefined : await this.generation.watch();
      const detach = () => {
        void watch?.stop().catch((error: unknown) => console.error("conversation.watch", error));
      };
      signal.addEventListener("abort", detach, { once: true });
      if (signal.aborted) detach();
      let delivering: Promise<void> | undefined;
      try {
        let shown = "",
          shownThinking = "",
          recalling = false;
        const thoughts = new Map<number, string>(),
          shownSearches = new Map<string, string>();
        if (!signal.aborted)
          watch?.start((live) => {
            delivering = (async () => {
              const message = live.message;
              if (message && live.busy && live.taskId !== undefined) {
                thoughts.set(live.taskId, message.thinking);
                const current = [...thoughts.values()].filter(Boolean).join("\n\n");
                if (current !== shownThinking) {
                  const append = current.startsWith(shownThinking);
                  await send({
                    type: "thinking",
                    text: append ? current.slice(shownThinking.length) : current,
                    replace: !append,
                  });
                  shownThinking = current;
                }
              }
              if (message) {
                const current = message.text;
                if (current.startsWith(shown)) {
                  if (current.length > shown.length)
                    await send({ type: "delta", text: current.slice(shown.length) });
                } else await send({ type: "replace", text: current });
                shown = current;
              }
              for (const search of this.journal.searches(admission.operation.attemptId)) {
                const value = JSON.stringify(search);
                if (shownSearches.get(search.id) !== value) {
                  await send({ type: "search", search });
                  shownSearches.set(search.id, value);
                }
              }
              if (live.recalling && !recalling) await send({ type: "status", phase: "recall" });
              else if (!live.recalling && recalling)
                await send({ type: "status", phase: "thinking" });
              recalling = live.recalling;
            })();
            return delivering;
          });
        const answered = await admission.submission.wait();
        if (lifecycle !== this.scope.alive) return;
        done = await this.finishOperation(admission.operation, answered);
      } finally {
        signal.removeEventListener("abort", detach);
        await watch?.stop();
        await delivering;
      }
    } finally {
      clearTimeout(admission.timer);
    }
    if (this.journal.read(input.requestId)?.status === "cancelled")
      await send({ type: "stopped", messages: this.history.rows(undefined, 80) });
    else if (done)
      await send({ type: "done", ...done, messages: this.history.rows(undefined, 80) });
    else await send({ type: "error", message: "这次没有顺利回复，请再试一次。" });
  }
  async alarm() {
    await this.transcript.sync();
    this.memory.pump();
    await this.memory.settle(25_000);
    if (this.memory.working() || (await this.busy())) this.scope.wake();
    await this.usage.touch();
  }
  async close() {
    this.memory.close();
    await this.generation.abort().catch(() => {});
    await Promise.allSettled([this.admitting, this.completing]);
    await this.transcript.close();
  }
}
