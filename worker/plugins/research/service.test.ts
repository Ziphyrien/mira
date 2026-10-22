import { describe, it, expect, afterEach, vi } from "vite-plus/test";
import { createTestScopePlatform } from "../../testing/node-sqlite";
import { ResearchService } from "./service";
import type { ResearchAgent, AgentDecision } from "./agent";
import { brief, plan } from "../../../tests/research-fixture";
import { numericSummary } from "./measurement";

const databases: ReturnType<typeof createTestScopePlatform>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.db.close();
});
async function setup(
  next: ResearchAgent["next"] = async () => ({
    decision: { intro: "下一题。", action: "finish" },
    cost: 0,
  }),
) {
  const db = createTestScopePlatform();
  databases.push(db);
  const agent: ResearchAgent = {
    plan: async () => ({ plan: structuredClone(plan), sources: [], cost: 0, model: "fixture" }),
    next,
  };
  const service = new ResearchService(db.storage, agent);
  service.queue("study", brief);
  await service.processPlanning();
  return { service, db, agent };
}
const consent = { eligible: true, consent: true };
function valueFor(q: (typeof plan.questions)[number]) {
  if (q.kind === "text") return '=HYPERLINK("x")';
  if (q.kind === "multiple") return [q.options[0].id];
  if (q.kind === "single" || q.kind === "select") return q.options[0].id;
  return q.min;
}
describe("research collection boundary", () => {
  it("restores a queued plan after reopening storage and exposes the completed draft", async () => {
    const db = createTestScopePlatform();
    databases.push(db);
    const agent: ResearchAgent = {
      plan: async () => ({ plan: structuredClone(plan), sources: [], cost: 0, model: "fixture" }),
      next: async () => ({ decision: { intro: "继续。", action: "core" }, cost: 0 }),
    };
    const first = new ResearchService(db.storage, agent);
    first.queue("job", brief);
    expect(first.planning()).toMatchObject({ id: "job", status: "planning" });
    const restored = new ResearchService(db.storage, agent);
    expect(restored.planning()?.status).toBe("planning");
    await restored.processPlanning();
    expect(restored.planning()).toBeNull();
    expect(restored.inspect().study.plan.title).toBe(plan.title);
  });
  it.each(["resolve", "reject"] as const)(
    "keeps a plan deleted while its model request later %ss",
    async (outcome) => {
      const db = createTestScopePlatform();
      databases.push(db);
      const pending = Promise.withResolvers<Awaited<ReturnType<ResearchAgent["plan"]>>>();
      const service = new ResearchService(db.storage, {
        plan: () => pending.promise,
        next: async () => ({ decision: { intro: "继续", action: "core" }, cost: 0 }),
      });
      service.queue("deleted", brief);
      const running = service.processPlanning().catch(() => undefined);
      service.remove();
      if (outcome === "resolve")
        pending.resolve({ plan: structuredClone(plan), sources: [], cost: 0, model: "fixture" });
      else pending.reject(new Error("disconnected"));
      await running;
      expect(service.planning()).toBeNull();
      expect(() => service.inspect()).toThrow("没有找到");
      expect(
        new ResearchService(db.storage, {
          plan: () => pending.promise,
          next: async () => ({ decision: { intro: "继续", action: "core" }, cost: 0 }),
        }).planning(),
      ).toBeNull();
    },
  );
  it("locks published measurements, validates answers, persists resumes and scores only complete fixed scales", async () => {
    const { service, db, agent } = await setup();
    expect(() => service.publicInfo()).toThrow("尚未发布");
    service.publish();
    expect(() => service.update(plan)).toThrow("已锁定");
    expect(() => service.start("a", "day", {})).toThrow();
    service.start("a", "day", consent);
    await expect(service.answer("a", { questionId: "autonomy", value: 6 })).rejects.toThrow(
      "不匹配",
    );
    await service.answer("a", { questionId: "autonomy", value: 5 });
    const resumed = new ResearchService(db.storage, agent);
    expect(resumed.readSession("a").current?.id).toBe("burden");
    await resumed.answer("a", { questionId: "autonomy", value: 5 });
    expect(resumed.readSession("a").answers).toHaveLength(1);
    await expect(resumed.answer("a", { questionId: "autonomy", value: 1 })).rejects.toThrow("不同");
    await resumed.answer("a", { questionId: "burden", value: 1 });
    await resumed.answer("a", { questionId: "balance", value: 75 });
    service.start("b", "day", consent);
    await service.answer("b", { questionId: "autonomy", value: null, nonresponse: "skip" });
    const result = service.inspect().results;
    expect(result.constructs[0].summary).toEqual({
      n: 1,
      mean: 275 / 3,
      sd: null,
    });
    expect(result.items[0]).toMatchObject({ n: 1, skipped: 1, notAsked: 0 });
    expect(result.items[1]).toMatchObject({ n: 1, skipped: 0, notAsked: 1 });
    const exported = JSON.parse(service.export("json"));
    expect(exported.participants[0]).not.toHaveProperty("id");
    expect(exported.participants[0]).not.toHaveProperty("lease");
  });
  it("fences concurrent requests and prevents an in-flight agent result from resurrecting withdrawn data", async () => {
    let release!: (value: { decision: AgentDecision; cost: number }) => void;
    const pending = new Promise<{ decision: AgentDecision; cost: number }>(
      (resolve) => (release = resolve),
    );
    const { service } = await setup(() => pending);
    service.publish();
    service.start("private-token", "day", consent);
    const first = service.answer("private-token", { questionId: "autonomy", value: 3 });
    expect(service.readSession("private-token").answers).toHaveLength(1);
    expect(service.readSession("private-token").current?.id).toBe("burden");
    await expect(
      service.answer("private-token", { questionId: "autonomy", value: 3 }),
    ).rejects.toThrow("正在处理");
    service.withdraw("private-token");
    release({ decision: { intro: "继续。", action: "core" }, cost: 0 });
    await expect(first).rejects.toThrow("不存在");
    expect(service.inspect().results.sessions).toBe(0);
    expect(service.export("json")).not.toContain("private-token");
  });
  it("revises a core answer without losing other core responses and rebuilds dependent probes", async () => {
    const { service } = await setup(async () => ({
      decision: {
        intro: "补充说明。",
        action: "probe",
        probe: { ...plan.questions[7], id: "extra" },
      },
      cost: 0,
    }));
    service.publish();
    service.start("edit", "day", consent);
    for (const q of plan.questions)
      await service.answer("edit", { questionId: q.id, value: valueFor(q) });
    await service.answer("edit", { questionId: "probe_1", value: "旧追问的回答" });
    const before = service
      .readSession("edit")
      .answers.filter((a) => a.question.source === "core")
      .slice(1);
    const changed = await service.revise("edit", { questionId: "autonomy", value: 5 });
    expect(changed.answers[0]).toMatchObject({ value: 5, editedAt: expect.any(Number) });
    expect(changed.answers.slice(1)).toEqual(before);
    expect(changed.current?.id).toBe("probe_1");
    expect(service.export("json")).not.toContain("旧追问的回答");
    await expect(service.revise("edit", { questionId: "autonomy", value: 999 })).rejects.toThrow(
      "不匹配",
    );
    expect(service.readSession("edit").answers[0].value).toBe(5);
    await service.revise("edit", { questionId: "autonomy", value: 5 });
    expect(service.readSession("edit").current?.id).toBe("probe_1");
    service.close();
    await expect(service.revise("edit", { questionId: "autonomy", value: 4 })).rejects.toThrow(
      "结束",
    );
  });
  it("preserves answers after provider failure and expires collected data", async () => {
    let fail = true;
    const { service, db } = await setup(async (_study, session) => {
      if (session.answers.filter((a) => a.question.source === "probe").length === 2)
        return { decision: { intro: "感谢分享。", action: "finish" }, cost: 0 };
      if (fail) throw new Error("offline");
      return {
        decision: {
          intro: "补充问题。",
          action: "probe",
          probe: { ...plan.questions[7], id: "extra" },
        },
        cost: 0,
      };
    });
    service.publish();
    service.start("a", "day", consent);
    for (const q of plan.questions) {
      await service.answer("a", {
        questionId: q.id,
        value: valueFor(q),
      });
      fail = false;
    }
    expect(service.readSession("a").current?.source).toBe("probe");
    await service.answer("a", { questionId: "probe_1", value: "补充一" });
    await service.answer("a", { questionId: "probe_2", value: "补充二" });
    expect(service.readSession("a").status).toBe("complete");
    expect(service.readSession("a").answers).toHaveLength(10);
    expect(service.inspect().results.constructs[0].summary.n).toBe(1);
    expect(service.export("csv")).toContain("'=HYPERLINK");
    const json = JSON.parse(service.export("json"));
    expect(json.participants[0].fallbackCount).toBe(1);
    const row = db.storage.sql.exec<{ data: string }>("SELECT data FROM research_meta").one();
    const study = JSON.parse(row.data);
    study.expiresAt = Date.now() - 1;
    db.storage.sql.exec("UPDATE research_meta SET data=?", JSON.stringify(study));
    service.expire();
    expect(service.inspect().results.sessions).toBe(0);
    expect(service.publicInfo().available).toBe(false);
  });
  it("continues after skipped answers and lets the agent address remaining information gaps", async () => {
    const { service } = await setup(async () => ({
      decision: { intro: "继续。", action: "probe", probe: plan.questions[7] },
      cost: 0,
    }));
    service.publish();
    service.start("a", "day", consent);
    for (const q of plan.questions) {
      const view = await service.answer("a", {
        questionId: q.id,
        value: q.id === "autonomy" || q.id === "burden" ? null : valueFor(q),
        nonresponse: q.id === "autonomy" || q.id === "burden" ? "skip" : undefined,
      });
      expect(view.paceCheck).toBe(false);
    }
    expect(service.readSession("a").current?.source).toBe("probe");
    expect(service.readSession("a").answers).toHaveLength(8);
  });
  it("lets a new study collect useful followups beyond the former cap and finish on the agent decision", async () => {
    const db = createTestScopePlatform();
    databases.push(db);
    const agent: ResearchAgent = {
      plan: async () => ({ plan: structuredClone(plan), sources: [], cost: 0, model: "fixture" }),
      next: async (_study, session) => ({
        decision:
          session.answers.filter((a) => a.question.source === "probe").length < 4
            ? { intro: "请补充具体情况。", action: "probe", probe: plan.questions[7] }
            : { intro: "感谢分享。", action: "finish" },
        cost: 0,
      }),
    };
    const service = new ResearchService(db.storage, agent);
    service.queue("adaptive", brief);
    await service.processPlanning();
    service.publish();
    service.start("s", "day", consent);
    for (const q of plan.questions)
      await service.answer("s", { questionId: q.id, value: valueFor(q) });
    for (let i = 1; i <= 4; i++) {
      expect(service.readSession("s").current?.id).toBe("probe_" + i);
      await service.answer("s", { questionId: "probe_" + i, value: "具体情况" + i });
    }
    expect(service.readSession("s").status).toBe("complete");
    expect(service.readSession("s").answers).toHaveLength(12);
  });
  it("keeps repeated-start protection scoped to the same address after withdrawal", async () => {
    const { service } = await setup();
    service.publish();
    for (let i = 0; i < 5; i++) {
      service.start("s" + i, "same-address", consent);
      service.withdraw("s" + i);
    }
    expect(() => service.start("overflow", "same-address", consent)).toThrow("今日参与次数");
    expect(service.start("other", "other-address", consent).status).toBe("active");
  });
  it("gives the participant control when their own words request a stop", async () => {
    const { service } = await setup(async () => ({
      decision: { intro: "我们可以按你的节奏继续。", action: "core", checkInQuote: "今天想先结束" },
      cost: 0,
    }));
    const reordered = structuredClone(plan);
    reordered.questions = [plan.questions[7], ...plan.questions.slice(0, 7)];
    service.update(reordered);
    service.publish();
    service.start("a", "day", consent);
    const next = await service.answer("a", {
      questionId: "context",
      value: "今天想先结束，之后再说。",
    });
    expect(next.paceCheck).toBe(true);
    expect(next.current?.id).toBe("autonomy");
    await expect(service.answer("a", { questionId: "autonomy", value: 3 })).rejects.toThrow(
      "先选择",
    );
    expect(service.finish("a").finishReason).toBe("participant");
    expect(service.readSession("a").answers).toHaveLength(1);
  });
  it("treats estimated duration as pacing context rather than discarding the remaining questions", async () => {
    const clock = vi.spyOn(Date, "now");
    let now = 1700000000000;
    clock.mockImplementation(() => now);
    const { service } = await setup(async () => ({
      decision: { intro: "补充。", action: "probe", probe: plan.questions[7] },
      cost: 0,
    }));
    service.publish();
    service.start("a", "day", consent);
    for (const q of plan.questions) {
      if (q.id === "context") now += plan.estimatedMinutes! * 60000 - 20000;
      let value: unknown = q.min;
      if (q.kind === "text") value = "体验";
      if (["single", "select"].includes(q.kind)) value = q.options[0].id;
      if (q.kind === "multiple") value = [q.options[0].id];
      await service.answer("a", { questionId: q.id, value });
    }
    expect(service.readSession("a").current?.source).toBe("probe");
    expect(service.readSession("a").answers).toHaveLength(8);
    service.start("b", "different", consent);
    now += plan.estimatedMinutes! * 60000 + 1;
    const end = await service.answer("b", { questionId: "autonomy", value: 3 });
    expect(end.status).toBe("active");
    expect(end.current?.id).toBe("burden");
  });
  it("keeps dimensions item-level unless the plan explicitly selects exploratory scoring", async () => {
    const { service } = await setup();
    const descriptive = structuredClone(plan);
    descriptive.constructs[0].scoring = "items_only";
    service.update(descriptive);
    service.publish();
    service.start("a", "day", consent);
    for (const id of ["autonomy", "burden", "balance"])
      await service.answer("a", { questionId: id, value: 5 });
    expect(service.inspect().results.constructs[0].summary.n).toBe(0);
    expect(service.inspect().results.items[0].numeric?.mean).toBe(5);
  });
  it("removes only selected empty responses and rejects changed or substantive records atomically", async () => {
    const { service } = await setup();
    service.publish();
    service.start("empty", "a", consent);
    service.start("skipped", "b", consent);
    service.start("valid", "c", consent);
    for (const q of plan.questions)
      await service.answer("skipped", { questionId: q.id, value: null, nonresponse: "skip" });
    await service.answer("valid", { questionId: plan.questions[0].id, value: 3 });
    const exported = JSON.parse(service.export("json"));
    const targets = exported.participants
      .filter((s: { answers: { value: unknown }[] }) => s.answers.every((a) => a.value === null))
      .map((s: { startedAt: number; updatedAt: number; version: string; answers: unknown[] }) => ({
        startedAt: s.startedAt,
        updatedAt: s.updatedAt,
        version: s.version,
        answerCount: s.answers.length,
      }));
    // Selectors must uniquely identify records, even when starts share a millisecond.
    const valid = exported.participants.find((s: { answers: { value: unknown }[] }) =>
      s.answers.some((a) => a.value !== null),
    );
    const validTarget = {
      startedAt: valid.startedAt,
      updatedAt: valid.updatedAt,
      version: valid.version,
      answerCount: valid.answers.length,
    };
    expect(() => service.removeEmptyResponses([...targets, validTarget])).toThrow();
    expect(service.inspect().results.sessions).toBe(3);
    expect(() =>
      service.removeEmptyResponses(
        targets.map((t: { updatedAt: number }) => ({ ...t, updatedAt: t.updatedAt - 1 })),
      ),
    ).toThrow();
    expect(service.inspect().results.sessions).toBe(3);
    expect(service.removeEmptyResponses(targets)).toEqual({ deleted: 2 });
    const after = JSON.parse(service.export("json"));
    expect(after.participants).toHaveLength(1);
    expect(after.participants[0].answers).toEqual(valid.answers);
    expect(after.study).toEqual(exported.study);
    expect(() => service.removeEmptyResponses(targets)).toThrow();
  });
  it("executes reviewed applicability, distinguishes missingness and preserves displaced data on revision", async () => {
    const { service, db, agent } = await setup();
    const design = structuredClone(plan);
    design.constructs = [];
    design.followupPolicy.enabled = false;
    const occurrence = {
      ...structuredClone(plan.questions[6]),
      id: "occurrence",
      constructId: "",
      prompt: "上周有几次这种经历？",
    };
    occurrence.responsePolicy.options = [
      { id: "unknown", label: "记不清", kind: "unknown", next: "continue" },
    ];
    const detail = {
      ...structuredClone(plan.questions[7]),
      id: "detail",
      constructId: "",
      applicability: {
        all: [{ questionId: "occurrence", operator: "gt" as const, value: 0 }],
        rationale: "询问有实际经历的人。",
      },
    };
    const elaboration = {
      ...structuredClone(detail),
      id: "elaboration",
      applicability: {
        all: [{ questionId: "detail", operator: "answered" as const, value: null }],
        rationale: "基于已述经历补充。",
      },
    };
    const general = { ...structuredClone(plan.questions[7]), id: "general", constructId: "" };
    general.responsePolicy.options = [];
    design.questions = [occurrence, detail, elaboration, general];
    const invalid = structuredClone(design);
    invalid.questions[1].applicability.all[0].questionId = "general";
    expect(() => service.update(invalid)).toThrow("前面的题目");
    service.update(design);
    service.publish();
    service.start("zero", "zero", consent);
    expect(service.inspect().results.items[1]).toMatchObject({
      notAsked: 1,
      notApplicable: 0,
      prerequisiteMissing: 0,
    });
    await expect(service.answer("zero", { questionId: "occurrence", value: null })).rejects.toThrow(
      "不匹配",
    );
    await expect(
      service.answer("zero", { questionId: "occurrence", value: 0, nonresponse: "unknown" }),
    ).rejects.toThrow("不匹配");
    const zero = await service.answer("zero", { questionId: "occurrence", value: 0 });
    expect(zero.current?.id).toBe("general");
    expect(zero.answeredCore).toBe(1);
    expect(zero.omitted).toEqual([
      { questionId: "detail", reason: "not_applicable" },
      { questionId: "elaboration", reason: "not_applicable" },
      { questionId: "general", reason: "not_reached" },
    ]);
    await expect(
      service.answer("zero", { questionId: "general", value: null, nonresponse: "skip" }),
    ).rejects.toThrow("不匹配");
    expect(service.finish("zero").finishReason).toBe("participant");
    service.start("unknown", "unknown", consent);
    const unknown = await service.answer("unknown", {
      questionId: "occurrence",
      value: null,
      nonresponse: "unknown",
    });
    expect(unknown.current?.id).toBe("general");
    expect(unknown.answeredCore).toBe(0);
    expect(unknown.omitted[0].reason).toBe("prerequisite_missing");
    await expect(
      service.answer("unknown", { questionId: "occurrence", value: null, nonresponse: "other" }),
    ).rejects.toThrow("不同");
    await service.answer("unknown", { questionId: "general", value: "一般看法" });
    const changed = await service.revise("unknown", { questionId: "occurrence", value: 2 });
    expect(changed.current?.id).toBe("detail");
    await service.answer("unknown", { questionId: "detail", value: "真实经历" });
    await service.answer("unknown", { questionId: "elaboration", value: "经历补充" });
    const revised = await service.revise("unknown", { questionId: "occurrence", value: 0 });
    expect(revised.status).toBe("complete");
    expect(revised.answers.map((a) => a.value)).toEqual([0, "一般看法"]);
    const reopened = new ResearchService(db.storage, agent);
    expect(reopened.readSession("unknown")).toEqual(revised);
    const exported = JSON.parse(reopened.export("json"));
    expect(
      exported.participants.flatMap((p: { invalidatedAnswers: { answer: { value: string } }[] }) =>
        p.invalidatedAnswers.map((x) => x.answer.value),
      ),
    ).toEqual(["真实经历", "经历补充"]);
    service.start("missing", "missing", consent);
    await service.answer("missing", {
      questionId: "occurrence",
      value: null,
      nonresponse: "unknown",
    });
    const stats = service.inspect().results;
    expect(stats).toMatchObject({ withResponses: 2, noResponses: 1, answers: 3 });
    expect(stats.items[0]).toMatchObject({
      n: 2,
      skipped: 1,
      numeric: { mean: 0 },
      nonresponses: [{ id: "unknown", count: 1 }],
    });
    expect(stats.items[1]).toMatchObject({
      n: 0,
      notApplicable: 2,
      prerequisiteMissing: 1,
      notAsked: 0,
    });
    expect(stats.items[3]).toMatchObject({ n: 1, notAsked: 2 });
    expect(service.export("csv")).toContain('"unknown"');
    expect(service.export("csv")).toContain('"prerequisite_missing"');
    expect(service.export("csv")).toContain('"not_applicable"');
    expect(service.export("csv")).toContain('"not_reached"');
  });
  it("honors a planned ending and disables adaptive followups when the reviewed plan does", async () => {
    const next = vi.fn<ResearchAgent["next"]>(async () => ({
      decision: { intro: "补充", action: "probe", probe: plan.questions[7] },
      cost: 0,
    }));
    const { service } = await setup(next);
    const design = structuredClone(plan);
    design.constructs = [];
    design.questions = [
      { ...structuredClone(plan.questions[0]), constructId: "" },
      { ...structuredClone(plan.questions[7]), constructId: "" },
    ];
    design.questions[0].responsePolicy.options = [
      { id: "decline", label: "不愿回答，结束访谈", kind: "declined", next: "finish" },
    ];
    design.followupPolicy.enabled = false;
    service.update(design);
    service.publish();
    service.start("decline", "decline", consent);
    const ended = await service.answer("decline", {
      questionId: "autonomy",
      value: null,
      nonresponse: "decline",
    });
    expect(ended).toMatchObject({ status: "complete", finishReason: "plan", answeredCore: 0 });
    expect(next).not.toHaveBeenCalled();
    service.start("answer", "answer", consent);
    await service.answer("answer", { questionId: "autonomy", value: 3 });
    const completed = await service.answer("answer", { questionId: "context", value: "描述经历" });
    expect(completed.status).toBe("complete");
    expect(next).toHaveBeenCalledTimes(1);
    const edited = await service.revise("answer", {
      questionId: "autonomy",
      value: null,
      nonresponse: "decline",
    });
    expect(edited.answers).toHaveLength(1);
    expect(edited.finishReason).toBe("plan");
  });
  it("continues a minimal research request after persisted clarification and confirms facts only at publication", async () => {
    const db = createTestScopePlatform();
    databases.push(db);
    let round = 0;
    const agent: ResearchAgent = {
      plan: async () => {
        round++;
        return round === 1
          ? {
              clarifications: [{ question: "想了解谁的经历？", reason: "据此确定适用人群。" }],
              sources: [],
              cost: 0.1,
              model: "fixture",
            }
          : { plan: structuredClone(plan), sources: [], cost: 0.2, model: "fixture" };
      },
      next: async () => ({ decision: { action: "finish", intro: "谢谢" }, cost: 0 }),
    };
    const first = new ResearchService(db.storage, agent);
    first.queue("minimal", { topic: "我想研究协作体验" });
    await first.processPlanning();
    expect(first.planning()?.status).toBe("clarifying");
    expect(first.summary().status).toBe("clarifying");
    expect(() => first.retry()).toThrow("补充");
    const resumed = new ResearchService(db.storage, agent);
    resumed.clarify("了解自愿参与的混合办公职员，结果供研究团队使用。");
    await resumed.processPlanning();
    const draft = resumed.inspect().study;
    expect(draft.planningContext?.exchanges[0].answer).toContain("混合办公职员");
    expect(draft.cost).toBeCloseTo(0.3);
    expect(() => resumed.publish()).toThrow("确认参与对象");
    expect(resumed.inspect().study.status).toBe("draft");
    resumed.publish({
      population: "实际邀请对象",
      purpose: brief.purpose,
      contact: brief.contact,
      eligibility: "",
      retentionDays: 14,
    });
    expect(resumed.publicInfo()).toMatchObject({
      population: "实际邀请对象",
      retentionDays: 14,
      eligibility: "",
    });
  });
  it("preserves a draft during Agent revision and fences cancelled results from a subsequent revision", async () => {
    const { service, agent } = await setup();
    const original = service.inspect().study;
    const pending = Promise.withResolvers<Awaited<ReturnType<ResearchAgent["plan"]>>>();
    agent.plan = () => pending.promise;
    service.refine("调整研究对象并保留原测量范围");
    const running = service.processPlanning();
    expect(() => service.publish()).toThrow("完成方案准备");
    expect(service.cancelRefinement().study).toEqual(original);
    service.refine("减少负担，保留构念覆盖");
    pending.resolve({
      plan: { ...plan, title: "已经取消的方案" },
      sources: [],
      cost: 0,
      model: "fixture",
    });
    expect(await running).toBeNull();
    expect(service.planning()?.status).toBe("planning");
    agent.plan = async (_brief, _id, _signal, context) => ({
      plan: { ...context!.revision!.plan, title: "降低负担后的方案" },
      sources: [],
      cost: 0.2,
      model: "fixture",
    });
    await service.processPlanning();
    expect(service.inspect().study.plan.title).toBe("降低负担后的方案");
    expect(service.inspect().study.version).not.toBe(original.version);
    expect(service.inspect().study.planningContext?.revision?.instruction).toBe(
      "减少负担，保留构念覆盖",
    );
    service.publish();
    expect(() => service.refine("修改已发布测量")).toThrow("无法调整");
  });
  it("executes an adaptive DAG with interleaved clarification, rejects cycles and recomputes dependent answers", async () => {
    const { service } = await setup(async (_study, session) => {
      const last = session.answers.at(-1)!;
      if (last.question.id === "gate")
        return {
          decision: {
            intro: "再了解一点经历",
            action: "probe",
            probe: { ...plan.questions[7], constructId: "", id: "extra" },
          },
          cost: 0,
        };
      if (last.question.source === "probe")
        return {
          decision: { intro: "接下来", action: "core", questionId: "independent" },
          cost: 0,
        };
      if (last.question.id === "independent")
        return { decision: { intro: "再聊聊", action: "core", questionId: "detail" }, cost: 0 };
      return { decision: { intro: "谢谢", action: "finish" }, cost: 0 };
    });
    const design = structuredClone(plan);
    design.constructs = [];
    design.followupPolicy = {
      enabled: true,
      placement: "interleaved",
      coreOrder: "adaptive",
      rationale: "按经历澄清与选择话题。",
    };
    const detail = {
      ...structuredClone(plan.questions[7]),
      id: "detail",
      constructId: "",
      applicability: {
        all: [{ questionId: "gate", operator: "gt" as const, value: 0 }],
        rationale: "有经历时呈现。",
      },
    };
    const gate = { ...structuredClone(plan.questions[6]), id: "gate", constructId: "" };
    const independent = {
      ...structuredClone(plan.questions[7]),
      id: "independent",
      constructId: "",
    };
    design.questions = [detail, gate, independent];
    const cyclic = structuredClone(design);
    cyclic.questions[1].applicability.all = [
      { questionId: "detail", operator: "answered", value: null },
    ];
    expect(() => service.update(cyclic)).toThrow("无环图");
    service.update(design);
    service.publish();
    expect(service.start("dag", "dag", consent).current?.id).toBe("gate");
    expect((await service.answer("dag", { questionId: "gate", value: 1 })).current?.id).toBe(
      "probe_1",
    );
    expect(
      (await service.answer("dag", { questionId: "probe_1", value: "真实经历" })).current?.id,
    ).toBe("independent");
    expect(
      (await service.answer("dag", { questionId: "independent", value: "独立信息" })).current?.id,
    ).toBe("detail");
    await service.answer("dag", { questionId: "detail", value: "细节" });
    const revised = await service.revise("dag", { questionId: "gate", value: 0 });
    expect(revised.answers.map((a) => a.question.id)).toEqual(["gate", "independent"]);
    expect(revised.omitted).toContainEqual({ questionId: "detail", reason: "not_applicable" });
  });

  it("keeps observation windows provisional, records later continuation and separates final disposition from flow ending", async () => {
    let now = 1700000000000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { service } = await setup();
    const design = structuredClone(plan);
    design.followupPolicy.enabled = false;
    design.progressPolicy = {
      returnWindowHours: 2,
      rationale: "按本研究约定的续答观察期比较作答状态。",
    };
    design.responseCriteria = {
      rationale: "完整指标需要全部适用核心题。部分资料用于逐题描述。",
      complete: { minimumAnsweredFraction: 1, essentialQuestionIds: [] },
      partial: { minimumAnsweredFraction: 0.1, essentialQuestionIds: [] },
    };
    service.update(design);
    service.publish();
    service.start("return", "return", consent);
    await service.answer("return", { questionId: "autonomy", value: 3 });
    now += 3 * 3600000;
    const before = JSON.parse(service.export("json"));
    expect(before.statistics).toMatchObject({
      windowElapsed: 1,
      ongoing: 0,
      completed: 1,
      paused: 0,
      dispositions: { partial: 1 },
    });
    expect(before.participants[0].observation).toMatchObject({
      state: "ended",
      endReason: "inactivity",
      windowElapsed: true,
      endedAt: null,
      coverage: { answered: 1, knownApplicable: 8, lower: 0.125, upper: 0.125 },
    });
    service.recordPresence("return", { tabId: crypto.randomUUID(), sequence: 1, state: "visible" });
    expect(service.inspect().results).toMatchObject({ ongoing: 1, completed: 0, windowElapsed: 0 });
    await service.answer("return", { questionId: "burden", value: 2 });
    const resumed = JSON.parse(service.export("json"));
    expect(resumed.participants[0].observation.state).toBe("ongoing");
    service.finish("return");
    expect(service.inspect().results).toMatchObject({
      endings: { participant: 1 },
      dispositions: { partial: 1 },
    });
    now += 60000;
    service.recordPresence("return", { tabId: crypto.randomUUID(), sequence: 1, state: "visible" });
    await service.revise("return", { questionId: "autonomy", value: 4 });
    expect(service.inspect().results.ongoing).toBe(1);
    service.close();
    const final = JSON.parse(service.export("json"));
    expect(final.participants[0].observation).toMatchObject({
      state: "ended",
      endReason: "collection_closed",
      unresolvedAtClose: true,
    });
    expect(final.participants[0].answerRevisions[0].before.value).toBe(3);
    expect(
      final.participants[0].events
        .filter((e: { kind: string }) => e.kind === "state")
        .map((e: { state: string }) => e.state),
    ).toEqual(["active", "complete", "active"]);
    expect(before.participants[0].observation).toMatchObject({
      state: "ended",
      endReason: "inactivity",
      windowElapsed: true,
    });
  });
  it("preserves original reference time on revision and records effective collection context separately", async () => {
    let now = 1700000000000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { service } = await setup();
    const design = structuredClone(plan);
    design.questions[0].temporal = {
      anchor: "session_start",
      description: "以开始访谈时为参考，回想此前一周。",
    };
    service.update(design);
    service.publish();
    service.start("time", "time", { ...consent, timeZone: "Asia/Shanghai" });
    const began = now;
    now += 60000;
    await service.answer("time", { questionId: "autonomy", value: 3 });
    now += 86400000;
    await service.revise("time", { questionId: "autonomy", value: 4 });
    const before = service.readSession("time").answers[0];
    expect(before.question).toMatchObject({ referenceAt: began, timeZone: "Asia/Shanghai" });
    service.addCollectionNote({
      description: "招募渠道增加了一个团队。",
      from: now - 3600000,
      until: null,
    });
    const data = JSON.parse(service.export("json"));
    expect(data.study.collectionNotes[0]).toMatchObject({ from: now - 3600000, recordedAt: now });
    expect(data.participants[0].answers[0]).toEqual(before);
    expect(service.export("csv")).toContain("reference_at");
  });

  it("recovers a persisted answer after interrupted generation without treating processing as completion", async () => {
    let now = 1700000000000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const pending = Promise.withResolvers<Awaited<ReturnType<ResearchAgent["next"]>>>();
    const { service, db, agent } = await setup(() => pending.promise);
    const design = structuredClone(plan);
    design.constructs = [];
    design.questions = [{ ...plan.questions[7], constructId: "" }];
    service.update(design);
    service.publish();
    service.start("restart", "restart", consent);
    service.recordPresence("restart", {
      tabId: crypto.randomUUID(),
      sequence: 1,
      state: "visible",
    });
    const sending = service.answer("restart", { questionId: "context", value: "已提交的经历" });
    expect(service.readSession("restart")).toMatchObject({
      status: "active",
      processing: true,
      answers: [{ value: "已提交的经历" }],
    });
    expect(service.inspect().results.ongoing).toBe(1);
    now += 61000;
    const reopened = new ResearchService(db.storage, agent);
    expect(reopened.readSession("restart")).toMatchObject({
      status: "complete",
      processing: false,
      finishReason: "complete",
    });
    pending.resolve({
      decision: { action: "probe", intro: "已经过期的追问", probe: plan.questions[7] },
      cost: 0,
    });
    await expect(sending).rejects.toThrow("状态已经变更");
    expect(reopened.readSession("restart").answers).toHaveLength(1);
    expect(reopened.readSession("restart").current).toBeNull();
  });

  it("does not let an expired processing lease reopen an ended response in exports", async () => {
    let now = 1700000000000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { service, db } = await setup();
    service.publish();
    service.start("ended", "ended", consent);
    service.finish("ended");
    service.recordPresence("ended", { tabId: crypto.randomUUID(), sequence: 1, state: "visible" });
    const raw = JSON.parse(
      db.storage.sql
        .exec<{ data: string }>("SELECT data FROM research_sessions WHERE id='ended'")
        .one().data,
    );
    raw.lease = { token: "old-process", until: now + 60000 };
    db.storage.sql.exec(
      "UPDATE research_sessions SET data=? WHERE id='ended'",
      JSON.stringify(raw),
    );
    expect(service.inspect().results.ongoing).toBe(1);
    now += 61000;
    const exported = JSON.parse(service.export("json"));
    expect(exported.statistics.completed).toBe(1);
    expect(exported.participants[0]).toMatchObject({
      status: "complete",
      processing: false,
      observation: { state: "ended", endReason: "participant", processing: false },
    });
  });
  it("pauses hidden, departed and stale pages without changing responses or losing later continuation", async () => {
    let now = 1700000000000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { service } = await setup();
    service.publish();
    service.start("present", "present", consent);
    const first = JSON.parse(service.export("json")).participants[0];
    expect(service.inspect().results).toMatchObject({ ongoing: 0, paused: 1 });
    const tabId = crypto.randomUUID(),
      otherTab = crypto.randomUUID();
    const report = (state: string, sequence: number, tab = tabId) =>
      service.recordPresence("present", { tabId: tab, sequence, state });
    report("visible", 1);
    expect(service.inspect().results.ongoing).toBe(1);
    report("hidden", 3);
    report("visible", 2);
    expect(service.inspect().results).toMatchObject({ ongoing: 0, paused: 1 });
    report("visible", 1, otherTab);
    report("left", 4);
    expect(service.inspect().results.ongoing).toBe(1);
    report("left", 2, otherTab);
    expect(service.inspect().results.paused).toBe(1);
    report("visible", 5);
    now += 61000;
    expect(service.inspect().results).toMatchObject({ ongoing: 0, paused: 1 });
    const stale = JSON.parse(service.export("json")).participants[0];
    expect(stale.pagePresence.state).toBe("unknown");
    expect(stale.updatedAt).toBe(first.updatedAt);
    expect(stale.answers).toEqual(first.answers);
    expect(stale.events).toEqual(first.events);
    report("visible", 6);
    await service.answer("present", { questionId: "autonomy", value: 3 });
    expect(service.inspect().results.ongoing).toBe(1);
    service.finish("present");
    report("visible", 7);
    expect(service.inspect().results).toMatchObject({ ongoing: 0, paused: 0, completed: 1 });
    service.withdraw("present");
    expect(() => report("visible", 8)).toThrow("不存在");
    service.start("present", "present", consent);
    expect(JSON.parse(service.export("json")).participants[0].pagePresence.state).toBe("unknown");
  });
  it("reports descriptive sample statistics including empty and single observations", () => {
    expect(numericSummary([])).toEqual({ n: 0, mean: null, sd: null });
    expect(numericSummary([2])).toEqual({ n: 1, mean: 2, sd: null });
    const actual = numericSummary([1, 2, 3, 4, 5]);
    expect(actual.mean).toBe(3);
    expect(actual.sd).toBeCloseTo(1.581139, 5);
  });
});
