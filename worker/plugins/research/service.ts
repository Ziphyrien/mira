import { z } from "zod";
import type { AtomicStorage } from "../../core/storage";
import {
  ResearchBrief,
  ParticipationSettings,
  CollectionNoteInput,
  type PlanningContext,
  ResearchPlan,
  ResearchAnswer,
  type ResearchStudy,
  type ResearchSession,
  type PublicStudy,
  type InterviewView,
  type InterviewQuestion,
  type ResearchPlanning,
  type StudySummary,
} from "../../../src/lib/contracts/research";
import { ResearchError, type ResearchAgent } from "./agent";
import { validateAnswer, summarizeStudy, csvExport } from "./measurement";
import { applicability, remainingQuestions, omittedQuestions } from "./flow";
import { recordState, observeSession } from "./observation";
import { orderQuestions } from "../../../src/lib/contracts/question-graph";
import { ResearchPresence } from "./presence";

export class ResearchService {
  private readonly presence: ResearchPresence;
  constructor(
    private readonly storage: AtomicStorage,
    private readonly agent: ResearchAgent,
  ) {
    this.presence = new ResearchPresence(storage);
    storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS research_planning (id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL)",
    );
    storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS research_meta (id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL)",
    );
    storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS research_sessions (id TEXT PRIMARY KEY,data TEXT NOT NULL)",
    );
    storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS research_rates (key TEXT PRIMARY KEY,count INTEGER NOT NULL)",
    );
  }
  queue(id: string, input: unknown): ResearchPlanning {
    const brief = ResearchBrief.parse(input);
    if (
      this.storage.sql.exec("SELECT id FROM research_meta").toArray().length ||
      this.storage.sql.exec("SELECT id FROM research_planning").toArray().length
    )
      throw new ResearchError(409, "研究已经创建。");
    const pending = {
      id,
      topic: brief.topic.slice(0, 100),
      createdAt: Date.now(),
      status: "planning" as const,
      runId: crypto.randomUUID(),
      brief,
    };
    this.storage.sql.exec("INSERT INTO research_planning VALUES(1,?)", JSON.stringify(pending));
    return this.planning()!;
  }
  planning(): ResearchPlanning | null {
    const row = this.storage.sql
      .exec<{ data: string }>("SELECT data FROM research_planning WHERE id=1")
      .toArray()[0];
    if (!row) return null;
    const pending = JSON.parse(row.data) as ResearchPlanning;
    return {
      id: pending.id,
      topic: pending.topic,
      createdAt: pending.createdAt,
      status: pending.status,
      message: pending.message,
      questions: pending.questions,
      revising: pending.revising,
    };
  }
  private planningRecord() {
    const row = this.storage.sql
      .exec<{ data: string }>("SELECT data FROM research_planning WHERE id=1")
      .toArray()[0];
    if (!row) throw new ResearchError(404, "没有找到生成任务。");
    return JSON.parse(row.data) as ResearchPlanning & {
      brief: ResearchBrief;
      context?: PlanningContext;
      baseVersion?: string;
      runId: string;
    };
  }
  async processPlanning(signal?: AbortSignal) {
    const pending = this.planningRecord();
    if (pending.status !== "planning") return null;
    const result = await this.agent.plan(pending.brief, pending.id, signal, pending.context);
    return this.storage.transactionSync(() => {
      if (!this.planning() || this.planningRecord().runId !== pending.runId) return null;
      if (
        pending.baseVersion &&
        (this.study().version !== pending.baseVersion || this.study().status !== "draft")
      )
        return null;
      if ("clarifications" in result) {
        pending.status = "clarifying";
        pending.questions = result.clarifications;
        pending.context = {
          ...pending.context,
          exchanges: pending.context?.exchanges ?? [],
          sources: result.sources,
          cost: (pending.context?.cost ?? 0) + result.cost,
        };
        this.storage.sql.exec(
          "UPDATE research_planning SET data=? WHERE id=1",
          JSON.stringify(pending),
        );
        return null;
      }
      const study: ResearchStudy = {
        id: pending.id,
        brief: pending.brief,
        ...result,
        plan: ResearchPlan.parse(result.plan),
        cost: result.cost + (pending.context?.cost ?? 0),
        planningContext: {
          ...pending.context,
          exchanges: pending.context?.exchanges ?? [],
          sources: result.sources,
          cost: result.cost + (pending.context?.cost ?? 0),
        },
        status: "draft",
        createdAt: pending.createdAt,
        version: crypto.randomUUID(),
      };
      this.save(study);
      this.storage.sql.exec("DELETE FROM research_planning");
      return study;
    });
  }
  failPlanning(message: string) {
    if (!this.planning()) return;
    const pending = this.planningRecord();
    pending.status = "failed";
    pending.message = message;
    this.storage.sql.exec(
      "UPDATE research_planning SET data=? WHERE id=1",
      JSON.stringify(pending),
    );
  }
  retry() {
    const pending = this.planningRecord();
    if (pending.status === "planning") return this.planning()!;
    if (pending.status === "clarifying") throw new ResearchError(409, "请先补充研究背景。");
    pending.status = "planning";
    pending.runId = crypto.randomUUID();
    delete pending.message;
    this.storage.sql.exec(
      "UPDATE research_planning SET data=? WHERE id=1",
      JSON.stringify(pending),
    );
    return this.planning()!;
  }

  clarify(input: unknown) {
    const answer = z.string().trim().min(1).max(12000).parse(input);
    const pending = this.planningRecord();
    if (pending.status !== "clarifying" || !pending.questions)
      throw new ResearchError(409, "当前无需补充回答。");
    pending.context ??= { exchanges: [], sources: [], cost: 0 };
    pending.context.exchanges.push({ questions: pending.questions, answer });
    delete pending.questions;
    pending.status = "planning";
    pending.runId = crypto.randomUUID();
    this.storage.sql.exec(
      "UPDATE research_planning SET data=? WHERE id=1",
      JSON.stringify(pending),
    );
    return this.planning()!;
  }
  refine(input: unknown) {
    const instruction = z.string().trim().min(1).max(12000).parse(input);
    const study = this.study();
    if (study.status !== "draft" || this.planning())
      throw new ResearchError(409, "当前方案无法调整。");
    const context: PlanningContext = {
      exchanges: study.planningContext?.exchanges ?? [],
      sources: study.sources,
      cost: study.cost,
      revision: { plan: study.plan, instruction },
    };
    const pending = {
      id: study.id,
      topic: study.plan.title,
      createdAt: study.createdAt,
      status: "planning",
      brief: study.brief,
      context,
      baseVersion: study.version,
      revising: true,
      runId: crypto.randomUUID(),
    };
    this.storage.sql.exec("INSERT INTO research_planning VALUES(1,?)", JSON.stringify(pending));
    return this.planning()!;
  }
  cancelRefinement() {
    const pending = this.planningRecord();
    if (!pending.revising) throw new ResearchError(409, "没有待恢复的方案。");
    this.storage.sql.exec("DELETE FROM research_planning");
    return this.inspect();
  }
  remove() {
    this.storage.transactionSync(() => {
      const exists = this.storage.sql.exec("SELECT id FROM research_meta").toArray().length > 0;
      if (exists && this.study().status === "published")
        throw new ResearchError(409, "请先结束收集，再删除研究。");
      this.presence.clear();
      this.storage.sql.exec("DELETE FROM research_sessions");
      this.storage.sql.exec("DELETE FROM research_rates");
      this.storage.sql.exec("DELETE FROM research_planning");
      this.storage.sql.exec("DELETE FROM research_meta");
    });
  }

  private study(): ResearchStudy {
    const row = this.storage.sql
      .exec<{ data: string }>("SELECT data FROM research_meta WHERE id=1")
      .toArray()[0];
    if (!row) throw new ResearchError(404, "没有找到这项研究。");
    return JSON.parse(row.data);
  }
  private save(study: ResearchStudy) {
    this.storage.sql.exec(
      "INSERT OR REPLACE INTO research_meta VALUES(1,?)",
      JSON.stringify(study),
    );
  }
  private session(id: string): ResearchSession {
    const row = this.storage.sql
      .exec<{ data: string }>("SELECT data FROM research_sessions WHERE id=?", id)
      .toArray()[0];
    if (!row) throw new ResearchError(404, "访谈记录不存在或已撤回。");
    return JSON.parse(row.data);
  }
  private put(s: ResearchSession) {
    this.storage.sql.exec(
      "INSERT OR REPLACE INTO research_sessions VALUES(?,?)",
      s.id,
      JSON.stringify(s),
    );
  }
  private available(study: ResearchStudy) {
    if (study.status !== "published" || !study.expiresAt || Date.now() >= study.expiresAt)
      throw new ResearchError(410, "这项研究已暂停或结束收集。");
  }
  private view(s: ResearchSession, study: ResearchStudy): InterviewView {
    const processing = Boolean(s.lease && s.lease.until > Date.now());
    return {
      status: processing ? "active" : s.status,
      processing,
      draftKey: study.id + ":" + s.startedAt,
      answers: s.answers,
      current: s.current
        ? {
            ...s.current,
            referenceAt: s.current.temporal?.anchor === "session_start" ? s.startedAt : undefined,
            timeZone: s.timeZone,
          }
        : null,
      message: s.message,
      finishReason: s.finishReason,
      paceCheck: s.paceCheck,
      answeredCore: s.answers.filter((a) => a.question.source === "core" && a.value !== null)
        .length,
      processedCore: s.answers.filter((a) => a.question.source === "core").length,
      omitted: omittedQuestions(study, s),
      totalCore: study.plan.questions.length,
    };
  }
  summary(): StudySummary {
    const pending = this.planning();
    if (pending)
      return {
        id: pending.id,
        topic: pending.topic,
        createdAt: pending.createdAt,
        status: pending.status,
      };
    this.expire();
    const study = this.study();
    return {
      id: study.id,
      topic: study.plan.title,
      createdAt: study.createdAt,
      status: study.status,
    };
  }
  inspect() {
    const study = this.study();
    const sessions = this.all();
    const at = Date.now();
    return { study, results: summarizeStudy(study, sessions, at, this.presence.snapshots(at)) };
  }
  publicInfo(): PublicStudy {
    const s = this.study();
    if (s.status === "draft") throw new ResearchError(404, "这项研究尚未发布。");
    const participation = ParticipationSettings.parse(s.participation);
    return {
      id: s.id,
      title: s.plan.title,
      welcome: s.plan.welcome,
      population: participation.population,
      purpose: participation.purpose,
      contact: participation.contact,
      estimatedMinutes: s.plan.estimatedMinutes,
      eligibility: participation.eligibility,
      retentionDays: participation.retentionDays,
      available: s.status === "published" && Boolean(s.expiresAt && Date.now() < s.expiresAt),
    };
  }
  update(input: unknown) {
    if (this.planning()) throw new ResearchError(409, "请等待方案调整完成，或保留原方案。");
    const plan = ResearchPlan.parse(input);
    const study = this.study();
    if (study.status !== "draft")
      throw new ResearchError(409, "发布后的核心题与计分规则已锁定，请创建新研究。");
    study.plan = plan;
    study.version = crypto.randomUUID();
    this.save(study);
    return study;
  }
  rename(input: unknown) {
    const title = ResearchPlan.shape.title.parse(input);
    const study = this.study();
    study.plan.title = title;
    this.save(study);
    return study;
  }
  publish(input?: unknown) {
    if (this.planning()) throw new ResearchError(409, "请先完成方案准备。");
    const study = this.study();
    if (study.status === "draft") {
      study.plan = ResearchPlan.parse(study.plan);
      const participation = ParticipationSettings.safeParse(input ?? study.brief);
      if (!participation.success)
        throw new ResearchError(400, "请确认参与对象、研究用途、联系方式和保存期限。");
      study.participation = participation.data;
      const now = Date.now();
      study.status = "published";
      study.publishedAt = now;
      study.expiresAt = now + participation.data.retentionDays * 86400000;
      this.save(study);
    } else if (study.status === "closed")
      throw new ResearchError(409, "已关闭的研究不能再次发布。");
    return study;
  }
  addCollectionNote(input: unknown) {
    const note = CollectionNoteInput.parse(input);
    const study = this.study();
    if (study.status === "draft") throw new ResearchError(409, "发布后可记录收集期间的变化。");
    (study.collectionNotes ??= []).push({
      ...note,
      id: crypto.randomUUID(),
      recordedAt: Date.now(),
    });
    this.save(study);
    return study;
  }
  close() {
    const study = this.study();
    study.status = "closed";
    study.closedAt ??= Date.now();
    this.save(study);
    return study;
  }
  start(sessionId: string, rateKey: string, consent: unknown) {
    const accepted = z
      .object({
        eligible: z.boolean().optional(),
        consent: z.literal(true),
        timeZone: z
          .string()
          .max(100)
          .optional()
          .refine((value) => {
            if (!value) return true;
            try {
              new Intl.DateTimeFormat("en", { timeZone: value });
              return true;
            } catch {
              return false;
            }
          }, "时区无效"),
      })
      .strict()
      .parse(consent);
    const study = this.study();
    if (study.participation?.eligibility && accepted.eligible !== true)
      throw new ResearchError(400, "请确认符合本研究的参与条件。");
    this.available(study);
    const existing = this.storage.sql
      .exec<{ data: string }>("SELECT data FROM research_sessions WHERE id=?", sessionId)
      .toArray()[0];
    if (existing) return this.view(JSON.parse(existing.data), study);
    return this.storage.transactionSync(() => {
      const rate =
        this.storage.sql
          .exec<{ count: number }>("SELECT count FROM research_rates WHERE key=?", rateKey)
          .toArray()[0]?.count ?? 0;
      if (rate >= 5) throw new ResearchError(429, "今日参与次数较多，请稍后再来。");
      this.storage.sql.exec("INSERT OR REPLACE INTO research_rates VALUES(?,?)", rateKey, rate + 1);
      const now = Date.now();
      const s: ResearchSession = {
        id: sessionId,
        version: study.version,
        startedAt: now,
        updatedAt: now,
        consentAt: now,
        events: [{ kind: "state", at: now, state: "active" }],
        timeZone: accepted.timeZone,
        status: "active",
        answers: [],
        current: null,
        message: study.plan.welcome,
        paceCheck: false,
        fallbackCount: 0,
        cost: 0,
      };
      s.current = { ...remainingQuestions(study, s)[0], source: "core" };
      this.put(s);
      return this.view(s, study);
    });
  }
  recordPresence(id: string, input: unknown) {
    this.available(this.study());
    this.session(id);
    return this.presence.record(id, input);
  }
  readSession(id: string) {
    const s = this.session(id),
      study = this.study();
    if (s.lease && s.lease.until <= Date.now()) {
      delete s.lease;
      s.fallbackCount++;
      const planEnded = s.answers.some((a) => a.nonresponse?.next === "finish");
      const next = planEnded ? undefined : remainingQuestions(study, s)[0];
      s.current = next ? { ...next, source: "core" } : null;
      if (!s.current) {
        recordState(s, "complete", planEnded ? "plan" : "complete", Date.now());
        s.message = study.plan.closing;
      }
      this.put(s);
    }
    return this.view(s, study);
  }
  async answer(id: string, input: unknown) {
    const answer = ResearchAnswer.parse(input),
      study = this.study();
    this.available(study);
    const token = crypto.randomUUID();
    const captured = this.storage.transactionSync(() => {
      const s = this.session(id);
      if (s.lease && s.lease.until > Date.now())
        throw new ResearchError(409, "上一条回答正在处理中，请稍后重试。");
      const previous = s.answers.find((a) => a.question.id === answer.questionId);
      if (previous) {
        if (
          JSON.stringify(previous.value) !== JSON.stringify(answer.value) ||
          previous.nonresponse?.id !== answer.nonresponse
        )
          throw new ResearchError(409, "这道题已经提交了不同的回答。");
        return { s, done: true };
      }
      if (s.paceCheck) throw new ResearchError(409, "请先选择继续或结束访谈。");
      if (s.status !== "active" || s.current?.id !== answer.questionId)
        throw new ResearchError(409, "问题已经更新，请刷新后继续。");
      if (!validateAnswer(s.current, answer.value, answer.nonresponse))
        throw new ResearchError(400, "回答与当前问题不匹配。");
      const at = Date.now();
      const question = {
        ...s.current,
        referenceAt: s.current.temporal?.anchor === "session_start" ? s.startedAt : undefined,
        timeZone: s.timeZone,
      };
      if (s.current.temporal?.anchor === "response_time") question.referenceAt = at;
      s.answers.push({
        question,
        value: answer.value,
        nonresponse: s.current.responsePolicy.options.find((o) => o.id === answer.nonresponse),
        at,
        elapsedMs: at - s.updatedAt,
        introduction: s.message,
      });
      s.updatedAt = at;
      (s.events ??= []).push({ kind: "answer", at, questionId: answer.questionId });
      const next = remainingQuestions(study, s)[0];
      s.current = next ? { ...next, source: "core" } : null;
      s.message = next ? "接下来，想了解另一个方面。" : study.plan.closing;

      s.lease = { token, until: at + 60000 };
      this.put(s);
      return { s, done: false };
    });
    if (captured.done) return this.view(captured.s, study);
    return this.advance(study, captured.s, token, answer.value);
  }
  async revise(id: string, input: unknown) {
    const answer = ResearchAnswer.parse(input),
      study = this.study();
    this.available(study);
    const token = crypto.randomUUID();
    const s = this.storage.transactionSync(() => {
      const s = this.session(id);
      if (s.lease && s.lease.until > Date.now())
        throw new ResearchError(409, "上一条回答正在处理中，请稍后重试。");
      const index = s.answers.findIndex((a) => a.question.id === answer.questionId),
        previous = s.answers[index];
      if (!previous) throw new ResearchError(404, "没有找到这条回答。");
      if (!validateAnswer(previous.question, answer.value, answer.nonresponse))
        throw new ResearchError(400, "回答与当前问题不匹配。");
      if (
        JSON.stringify(previous.value) === JSON.stringify(answer.value) &&
        previous.nonresponse?.id === answer.nonresponse
      )
        return null;
      (s.answerRevisions ??= []).push({ before: structuredClone(previous), at: Date.now() });
      (s.events ??= []).push({ kind: "revision", at: Date.now(), questionId: answer.questionId });
      previous.value = answer.value;
      previous.nonresponse = previous.question.responsePolicy.options.find(
        (o) => o.id === answer.nonresponse,
      );
      previous.editedAt = Date.now();
      s.answers = s.answers.filter(
        (a, i) =>
          a.question.source === "core" || (previous.question.source === "probe" && i <= index),
      );
      // Re-evaluate dependencies in published order. Preserve independent answers and
      // retain displaced responses in the export audit trail instead of silently losing them.
      const stopAt = s.answers.findIndex((a) => a.nonresponse?.next === "finish");
      if (stopAt >= 0)
        for (const answer of s.answers.splice(stopAt + 1))
          (s.invalidatedAnswers ??= []).push({ answer, at: Date.now(), reason: "routing_changed" });
      for (const q of orderQuestions(study.plan.questions)!) {
        const displaced = s.answers.find((a) => a.question.id === q.id);
        if (applicability(q, s.answers, study.plan.questions) === "applicable") continue;
        if (displaced) {
          (s.invalidatedAnswers ??= []).push({
            answer: displaced,
            at: Date.now(),
            reason: "routing_changed",
          });
          s.answers = s.answers.filter((a) => a !== displaced);
        }
      }
      const next = remainingQuestions(study, s)[0];
      s.current = next ? { ...next, source: "core" } : null;
      s.message = next ? "接下来，想了解另一个方面。" : study.plan.closing;
      recordState(s, "active", undefined, Date.now());
      s.paceCheck = false;
      s.updatedAt = Date.now();
      delete s.finishReason;
      s.lease = { token, until: Date.now() + 60000 };
      this.put(s);
      return s;
    });
    return s ? this.advance(study, s, token, answer.value) : this.readSession(id);
  }

  private async advance(study: ResearchStudy, s: ResearchSession, token: string, value: unknown) {
    const id = s.id;
    const remaining = remainingQuestions(study, s);
    const planFinished = s.answers.some((a) => a.nonresponse?.next === "finish");
    const followups = s.answers.filter((a) => a.question.source === "probe").length;
    let current: InterviewQuestion | null =
      !planFinished && remaining[0] ? { ...remaining[0], source: "core" } : null;
    let message = current ? "谢谢，接下来是另一个方面。" : study.plan.closing;
    const canClarify =
      value !== null ||
      (!remaining.length && s.answers.some((a) => a.value !== null)) ||
      (study.plan.followupPolicy.coreOrder === "adaptive" && remaining.length > 0);
    if (
      !planFinished &&
      canClarify &&
      (remaining.length > 0 || study.plan.followupPolicy.enabled)
    ) {
      try {
        const result = await this.agent.next(study, s);
        s.cost += result.cost;
        message = result.decision.intro;
        const quote = result.decision.checkInQuote;
        if (quote && typeof value === "string" && quote.length >= 4 && value.includes(quote))
          s.paceCheck = true;
        if (
          result.decision.action === "core" &&
          study.plan.followupPolicy.coreOrder === "adaptive" &&
          remaining.length
        ) {
          const selected = remaining.find((q) => q.id === result.decision.questionId);
          if (!selected) throw new ResearchError(502, "下一题选择未通过校验。");
          current = { ...selected, source: "core" };
        }
        if (
          study.plan.followupPolicy.enabled &&
          (!remaining.length || study.plan.followupPolicy.placement === "interleaved") &&
          result.decision.action === "probe" &&
          result.decision.probe
        ) {
          const p = result.decision.probe;
          if (
            (!p.constructId || study.plan.constructs.some((c) => c.id === p.constructId)) &&
            applicability(p, s.answers, study.plan.questions) === "applicable"
          ) {
            current = { ...p, id: "probe_" + (followups + 1), source: "probe", reverse: false };
          }
        }
        if (!current) message = study.plan.closing;
      } catch {
        s.fallbackCount++;
      }
    }
    if (!current) s.paceCheck = false;
    s.updatedAt = Date.now();
    s.current = current;
    s.message = message;
    if (current) recordState(s, "active", undefined, s.updatedAt);
    else recordState(s, "complete", planFinished ? "plan" : "complete", s.updatedAt);
    delete s.lease;
    return this.storage.transactionSync(() => {
      const latest = this.session(id);
      if (latest.lease?.token !== token) throw new ResearchError(409, "访谈状态已经变更。");
      this.available(this.study());
      this.put(s);
      return this.view(s, study);
    });
  }
  resume(id: string) {
    const study = this.study();
    this.available(study);
    const s = this.session(id);
    if (s.lease && s.lease.until > Date.now())
      throw new ResearchError(409, "上一条回答正在处理中。");
    s.paceCheck = false;
    s.updatedAt = Date.now();
    (s.events ??= []).push({ kind: "resume", at: s.updatedAt });
    this.put(s);
    return this.view(s, study);
  }
  finish(id: string) {
    const s = this.session(id);
    delete s.lease;
    s.current = null;
    recordState(s, "complete", "participant", Date.now());
    s.updatedAt = Date.now();
    s.paceCheck = false;
    s.message = "感谢你愿意分享，已回答的内容已保存。你仍可在此页面撤回本次数据。";
    this.put(s);
    return this.view(s, this.study());
  }
  withdraw(id: string) {
    this.storage.transactionSync(() => {
      this.storage.sql.exec("DELETE FROM research_sessions WHERE id=?", id);
      this.presence.remove(id);
    });
    return { withdrawn: true };
  }
  removeEmptyResponses(input: unknown) {
    const targets = z
      .array(
        z
          .object({
            startedAt: z.number().int().nonnegative(),
            updatedAt: z.number().int().nonnegative(),
            version: z.string().min(1),
            answerCount: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .parse(input);
    return this.storage.transactionSync(() => {
      const study = this.study();
      const sessions = this.all();
      const ids = new Set<string>();
      for (const target of targets) {
        const matches = sessions.filter(
          (s) =>
            s.startedAt === target.startedAt &&
            s.updatedAt === target.updatedAt &&
            s.version === target.version &&
            s.answers.length === target.answerCount,
        );
        if (matches.length !== 1)
          throw new ResearchError(409, "参与记录已变化或无法唯一确定，请刷新后重试。");
        const s = matches[0];
        if (ids.has(s.id)) throw new ResearchError(400, "请勿重复选择同一参与记录。");
        if (s.lease && s.lease.until > Date.now())
          throw new ResearchError(409, "这条记录正在处理回答，请稍后核对。");
        const empty = s.answers.length === 0;
        const allSkipped =
          s.answers.length > 0 &&
          s.answers.every((a) => a.value === null) &&
          study.plan.questions.every((q) => s.answers.some((a) => a.question.id === q.id));
        if (!empty && !allSkipped)
          throw new ResearchError(409, "此操作仅可删除未答题或全部预定题均跳过的记录。");
        ids.add(s.id);
      }
      for (const id of ids) {
        this.storage.sql.exec("DELETE FROM research_sessions WHERE id=?", id);
        this.presence.remove(id);
      }
      return { deleted: ids.size };
    });
  }
  private all() {
    return this.storage.sql
      .exec<{ data: string }>("SELECT data FROM research_sessions ORDER BY id")
      .toArray()
      .map((r) => JSON.parse(r.data) as ResearchSession);
  }
  export(format: string) {
    const study = this.study(),
      sessions = this.all();
    const observedAt = Date.now();
    const presence = this.presence.snapshots(observedAt);
    if (format === "csv") return csvExport(study, sessions, observedAt, presence);
    return JSON.stringify(
      {
        study,
        codebook: study.plan.questions,
        observedAt,
        statistics: summarizeStudy(study, sessions, observedAt, presence),
        participants: sessions.map((s, index) => ({
          participant: index + 1,
          ...this.view(s, study),
          version: s.version,
          consentAt: s.consentAt,
          timeZone: s.timeZone,
          startedAt: s.startedAt,
          updatedAt: s.updatedAt,
          fallbackCount: s.fallbackCount,
          cost: s.cost,
          invalidatedAnswers: s.invalidatedAnswers ?? [],
          answerRevisions: s.answerRevisions ?? [],
          events: s.events ?? [],
          observation: observeSession(study, s, observedAt, presence.get(s.id)),
          pagePresence: presence.get(s.id) ?? {
            state: "unknown",
            observedAt,
            lastSeenAt: null,
            freshUntil: null,
          },
        })),
      },
      null,
      2,
    );
  }
  expire() {
    const study = this.study();
    if (study.expiresAt && Date.now() >= study.expiresAt) {
      this.storage.transactionSync(() => {
        this.presence.clear();
        this.storage.sql.exec("DELETE FROM research_sessions");
        this.storage.sql.exec("DELETE FROM research_rates");
        study.status = "closed";
        this.save(study);
      });
    }
    return study.expiresAt;
  }
}
