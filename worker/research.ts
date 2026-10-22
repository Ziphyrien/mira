import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { ResearchService } from "./plugins/research/service";
import { createResearchAgent, ResearchError } from "./plugins/research/agent";
import type { ResearchResult, ResearchInspection } from "../src/lib/contracts/research";

/** One study owns its immutable instrument, response budget and participant records. */
export class Research extends DurableObject<Env> {
  private planningAbort?: AbortController;
  private readonly service = new ResearchService(
    this.ctx.storage,
    createResearchAgent(() => this.env.DIRECTORY.getByName("main").aiConfiguration()),
  );
  private async run<T>(work: () => T | Promise<T>): Promise<ResearchResult<T>> {
    try {
      return { ok: true, data: await work() };
    } catch (error) {
      if (error instanceof ResearchError)
        return { ok: false, status: error.status, message: error.message };
      if (error instanceof z.ZodError)
        return { ok: false, status: 400, message: "输入格式不正确，请检查题目、选项和范围。" };
      console.error("research.failed", error instanceof Error ? error.name : "unknown");
      return { ok: false, status: 500, message: "研究服务暂不可用，请稍后重试。" };
    }
  }
  begin(id: string, input: unknown) {
    return this.run(async () => {
      const pending = this.service.queue(id, input);
      await this.ctx.storage.setAlarm(Date.now() + 100);
      return pending;
    });
  }
  retry() {
    return this.run(async () => {
      const pending = this.service.retry();
      await this.ctx.storage.setAlarm(Date.now() + 100);
      return pending;
    });
  }
  clarify(answer: unknown) {
    return this.run(async () => {
      const pending = this.service.clarify(answer);
      await this.ctx.storage.setAlarm(Date.now() + 100);
      return pending;
    });
  }
  refine(instruction: unknown) {
    return this.run(async () => {
      const pending = this.service.refine(instruction);
      await this.ctx.storage.setAlarm(Date.now() + 100);
      return pending;
    });
  }
  cancelRefinement() {
    return this.run(async () => {
      const result = this.service.cancelRefinement();
      this.planningAbort?.abort();
      this.planningAbort = undefined;
      await this.ctx.storage.deleteAlarm();
      return { status: "ready" as const, ...result };
    });
  }
  inspect() {
    return this.run((): ResearchInspection => {
      const pending = this.service.planning();
      if (pending) return pending;
      this.service.expire();
      return { status: "ready", ...this.service.inspect() };
    });
  }
  summary() {
    return this.run(() => this.service.summary());
  }
  publicInfo() {
    return this.run(() => {
      this.service.expire();
      return this.service.publicInfo();
    });
  }
  update(plan: unknown) {
    return this.run(() => this.service.update(plan));
  }
  rename(title: unknown) {
    return this.run(() => this.service.rename(title));
  }
  publish(participation?: unknown) {
    return this.run(async () => {
      const study = this.service.publish(participation);
      if (study.expiresAt) await this.ctx.storage.setAlarm(study.expiresAt);
      return study;
    });
  }
  addCollectionNote(input: unknown) {
    return this.run(() => this.service.addCollectionNote(input));
  }
  close() {
    return this.run(() => this.service.close());
  }
  remove() {
    return this.run(async () => {
      this.service.remove();
      this.planningAbort?.abort();
      await this.ctx.storage.deleteAlarm();
      return { deleted: true };
    });
  }
  start(id: string, rateKey: string, consent: unknown) {
    return this.run(() => this.service.start(id, rateKey, consent));
  }
  readSession(id: string) {
    return this.run(() => {
      this.service.expire();
      return this.service.readSession(id);
    });
  }
  recordPresence(id: string, input: unknown) {
    return this.run(() => this.service.recordPresence(id, input));
  }
  answer(id: string, input: unknown) {
    return this.run(() => this.service.answer(id, input));
  }
  revise(id: string, input: unknown) {
    return this.run(() => this.service.revise(id, input));
  }
  resume(id: string) {
    return this.run(() => this.service.resume(id));
  }
  finish(id: string) {
    return this.run(() => {
      this.service.expire();
      return this.service.finish(id);
    });
  }
  withdraw(id: string) {
    return this.run(() => this.service.withdraw(id));
  }
  removeEmptyResponses(targets: unknown) {
    return this.run(() => this.service.removeEmptyResponses(targets));
  }
  exportData(format: string) {
    return this.run(() => {
      this.service.expire();
      return this.service.export(format);
    });
  }
  async alarm() {
    if (this.service.planning()?.status === "planning") {
      const controller = new AbortController();
      this.planningAbort = controller;
      try {
        const result = await this.run(() => this.service.processPlanning(controller.signal));
        if (!result.ok) {
          if (this.planningAbort === controller) this.service.failPlanning(result.message);
        } else if (result.data) {
          const directory = this.env.DIRECTORY.getByName("main");
          await directory.researchAdd({
            id: result.data.id,
            topic: result.data.plan.title,
            createdAt: result.data.createdAt,
          });
          const current = await this.summary();
          if (!current.ok && current.status === 404) await directory.researchRemove(result.data.id);
        }
      } finally {
        if (this.planningAbort === controller) this.planningAbort = undefined;
      }
      return;
    }
    if (this.service.planning()) return;
    const at = this.service.expire();
    if (at && at > Date.now()) await this.ctx.storage.setAlarm(at);
  }
}
