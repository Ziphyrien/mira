import type {
  AnswerValue,
  ResearchQuestion,
  ResearchSession,
  ResearchStudy,
  NumericSummary,
  StudyResults,
} from "../../../src/lib/contracts/research";

import { omittedQuestions } from "./flow";
import { observeSession } from "./observation";
import type { PagePresence } from "../../../src/lib/contracts/research-presence";

export function validateAnswer(
  q: ResearchQuestion,
  value: AnswerValue,
  nonresponse?: string,
): boolean {
  if (value === null)
    return Boolean(nonresponse && q.responsePolicy.options.some((o) => o.id === nonresponse));
  if (nonresponse !== undefined) return false;
  if (q.kind === "text") return typeof value === "string" && value.trim().length > 0;
  if (q.kind === "single" || q.kind === "select")
    return typeof value === "string" && q.options.some((o) => o.id === value);
  if (q.kind === "multiple")
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      new Set(value).size === value.length &&
      value.every((v) => q.options.some((o) => o.id === v))
    );
  if (typeof value !== "number" || !Number.isFinite(value) || value < q.min || value > q.max)
    return false;
  const steps = (value - q.min) / q.step;
  return Math.abs(steps - Math.round(steps)) < 1e-7;
}

export function numericSummary(values: number[]): NumericSummary {
  const n = values.length;
  if (!n) return { n, mean: null, sd: null };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, sd: null };
  const sd = Math.sqrt(values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1));
  return { n, mean, sd };
}
export function summarizeStudy(
  study: ResearchStudy,
  sessions: ResearchSession[],
  observedAt = Date.now(),
  presence: ReadonlyMap<string, PagePresence> = new Map(),
): StudyResults {
  const questions = study.plan.questions;
  const omitted = sessions.flatMap((s) => omittedQuestions(study, s));
  const observations = sessions.map((s) =>
    observeSession(study, s, observedAt, presence.get(s.id)),
  );

  const count = (state: string) => observations.filter((o) => o.state === state).length;
  const dispositionCount = (state: string) =>
    observations.filter((o) => o.disposition === state).length;
  return {
    sessions: sessions.length,
    observedAt,
    completed: count("ended"),
    ongoing: count("ongoing"),
    paused: count("paused"),
    windowElapsed: observations.filter((o) => o.windowElapsed).length,
    unresolvedAtClose: observations.filter((o) => o.unresolvedAtClose).length,
    endings: {
      protocol: observations.filter((o) => o.endReason === "protocol").length,
      participant: observations.filter((o) => o.endReason === "participant").length,
      plan: observations.filter((o) => o.endReason === "plan").length,
    },
    dispositions: {
      complete: dispositionCount("complete"),
      partial: dispositionCount("partial"),
      below_criteria: dispositionCount("below_criteria"),
      pending: dispositionCount("pending"),
      unclassified: dispositionCount("unclassified"),
    },
    answers: sessions.reduce((n, s) => n + s.answers.filter((a) => a.value !== null).length, 0),
    withResponses: sessions.filter((s) => s.answers.some((a) => a.value !== null)).length,
    noResponses: sessions.filter((s) => !s.answers.some((a) => a.value !== null)).length,
    items: questions.map((q) => {
      const answers = sessions.flatMap((s) =>
        s.answers.filter((a) => a.question.source === "core" && a.question.id === q.id),
      );
      const observed = answers.filter((a) => a.value !== null);
      return {
        id: q.id,
        prompt: q.prompt,
        kind: q.kind,
        n: observed.length,
        skipped: answers.length - observed.length,
        notAsked: omitted.filter((o) => o.questionId === q.id && o.reason === "not_reached").length,
        notApplicable: omitted.filter((o) => o.questionId === q.id && o.reason === "not_applicable")
          .length,
        prerequisiteMissing: omitted.filter(
          (o) => o.questionId === q.id && o.reason === "prerequisite_missing",
        ).length,
        nonresponses: q.responsePolicy.options.map((o) => ({
          id: o.id,
          label: o.label,
          kind: o.kind,
          count: answers.filter((a) => a.nonresponse?.id === o.id).length,
        })),
        byState: [...new Set(observations.map((o) => o.state))].map((state) => {
          const members = sessions.filter((_, i) => observations[i].state === state);
          const entries = members.flatMap((s) => s.answers.filter((a) => a.question.id === q.id));
          const values = entries.filter((a) => a.value !== null);
          return {
            state,
            n: values.length,
            nonresponse: entries.length - values.length,
            unreached: members.filter((s) =>
              omittedQuestions(study, s).some(
                (o) => o.questionId === q.id && o.reason === "not_reached",
              ),
            ).length,
            numeric: ["rating", "slider", "number"].includes(q.kind)
              ? numericSummary(values.map((a) => Number(a.value)))
              : null,
          };
        }),
        numeric: ["rating", "slider", "number"].includes(q.kind)
          ? numericSummary(observed.map((a) => Number(a.value)))
          : null,
        choices: q.options.map((o) => ({
          id: o.id,
          label: o.label,
          count: observed.filter((a) =>
            Array.isArray(a.value) ? a.value.includes(o.id) : a.value === o.id,
          ).length,
        })),
      };
    }),
    constructs: study.plan.constructs.map((c) => {
      const items = questions.filter(
        (q) => q.constructId === c.id && ["rating", "slider"].includes(q.kind),
      );
      const scores =
        c.scoring !== "exploratory_mean" || items.length < 2
          ? []
          : sessions.flatMap((s) => {
              const values = items.map((q) => {
                const answer = s.answers.find(
                  (a) => a.question.source === "core" && a.question.id === q.id,
                );
                if (typeof answer?.value !== "number") return null;
                const normalized = ((answer.value - q.min) / (q.max - q.min)) * 100;
                return q.reverse ? 100 - normalized : normalized;
              });
              if (values.some((v) => v === null)) return [];
              return [values.reduce<number>((sum, v) => sum + v!, 0) / items.length];
            });
      return { id: c.id, name: c.name, items: items.length, summary: numericSummary(scores) };
    }),
    limitations: [
      "统计为观察时点的快照。进行中仅表示前台连接观测有效；后台、离开或观测过期归为暂停。暂停、超过观察窗口和收集截止未结束分别记录；超过窗口只表示该窗口内未继续。资料完整度分类按方案中的标准计算；收集开始后的补充规则须作为探索性分类解释，修订时间和原方案随导出保留。适用题数尚不确定时保留未分类。分状态描述可比较组成差异；差异本身不能证明非回应偏差或因果关系。",
      "当前数据适合描述自愿参与的样本。总体推断需要适当的抽样设计，因果解释需要相应的研究设计支持。",
      "当前汇总为描述统计。区间估计、组间比较和假设检验需结合抽样、聚类、缺失和预先确定的分析方案。",
      "提交时点、修订时点和回答参考期分别保留。收集期间的变化见JSON导出的collectionNotes；有效时段与记录时点分开。跨期比较需评估时间效应、样本构成与测量等值性。elapsedMs是服务端相邻呈现与提交的时间间隔，包含离开页面与网络等待。",
      "维度分数用于探索性描述，评分与滑块按近似等距处理。至少两道核心量尺题且全部作答时，按固定上下界归一至0–100后等权平均；正式应用前需验证信度与效度。",
      "动态追问与开放文本作为解释性材料保留。主动非回答、不适用、前置资料缺失和未到达分别记录，统计使用实际回答；进行中访谈的已答核心题也进入逐题汇总。未据缺失类型自动判定随机缺失机制或填补值。",
    ],
  };
}
export function csvExport(
  study: ResearchStudy,
  sessions: ResearchSession[],
  observedAt = Date.now(),
  presence: ReadonlyMap<string, PagePresence> = new Map(),
): string {
  const cell = (v: unknown) => {
    let text = typeof v === "string" ? v : JSON.stringify(v ?? "");
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows: unknown[][] = [
    [
      "study_id",
      "version",
      "participant",
      "status",
      "question_id",
      "source",
      "construct",
      "kind",
      "prompt",
      "value",
      "missing",
      "answered_at",
      "elapsed_ms",
      "purpose",
      "edited_at",
      "nonresponse_id",
      "nonresponse_label",
      "reference_anchor",
      "reference_at",
      "reference_description",
      "reference_from",
      "reference_until",
      "time_zone",
      "observed_at",
      "observation_state",
      "observed_duration_ms",
      "last_action_at",
      "return_window_until",
      "analysis_disposition",
      "end_reason",
      "return_window_elapsed",
      "unresolved_at_close",
      "analysis_rule_timing",
      "page_state",
      "page_last_seen_at",
    ],
  ];
  sessions.forEach((s, index) => {
    const observation = observeSession(study, s, observedAt, presence.get(s.id));
    const observationCells = [
      new Date(observedAt).toISOString(),
      observation.state,
      observation.observedDurationMs,
      new Date(observation.lastActionAt).toISOString(),
      observation.returnWindowUntil === null
        ? null
        : new Date(observation.returnWindowUntil).toISOString(),
      observation.disposition,
      observation.endReason,
      observation.windowElapsed,
      observation.unresolvedAtClose,
      observation.analysisRuleTiming,
      presence.get(s.id)?.state ?? "unknown",
      presence.get(s.id)?.lastSeenAt ?? null,
    ];
    for (const a of s.answers)
      rows.push([
        study.id,
        s.version,
        index + 1,
        s.status,
        a.question.id,
        a.question.source,
        a.question.constructId,
        a.question.kind,
        a.question.prompt,
        a.value,
        a.value === null ? a.nonresponse?.kind : "",
        new Date(a.at).toISOString(),
        a.elapsedMs,
        a.question.purpose,
        a.editedAt ? new Date(a.editedAt).toISOString() : null,
        a.nonresponse?.id ?? null,
        a.nonresponse?.label ?? null,
        a.question.temporal?.anchor ?? null,
        a.question.referenceAt === undefined
          ? null
          : new Date(a.question.referenceAt).toISOString(),
        a.question.temporal?.description ?? null,
        a.question.temporal?.from ?? null,
        a.question.temporal?.until ?? null,
        a.question.timeZone ?? null,
        ...observationCells,
      ]);
    const omitted = omittedQuestions(study, s);
    for (const q of study.plan.questions)
      if (!s.answers.some((a) => a.question.id === q.id))
        rows.push([
          study.id,
          s.version,
          index + 1,
          s.status,
          q.id,
          "core",
          q.constructId,
          q.kind,
          q.prompt,
          null,
          omitted.find((o) => o.questionId === q.id)!.reason,
          null,
          null,
          q.purpose,
          null,
          null,
          null,
          q.temporal?.anchor ?? null,
          null,
          q.temporal?.description ?? null,
          q.temporal?.from ?? null,
          q.temporal?.until ?? null,
          s.timeZone ?? null,
          ...observationCells,
        ]);
  });
  return "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
