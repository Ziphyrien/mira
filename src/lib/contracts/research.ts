import { z } from "zod";
import { orderQuestions } from "./question-graph";

const short = z.string().trim().min(1).max(500);
const id = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const option = z.object({ id, label: z.string().min(1).max(120) }).strict();
export const ResponsePolicy = z
  .object({
    rationale: short.describe(
      "Measurement rationale for allowing or omitting nonresponse choices, their analysis and routing; follow validated instrument requirements when applicable.",
    ),
    options: z
      .array(
        z
          .object({
            id,
            label: z.string().trim().min(1).max(120),
            kind: z.enum(["declined", "unknown", "not_applicable", "unspecified"]),
            next: z.enum(["continue", "finish"]),
          })
          .strict(),
      )
      .describe(
        "Explicit nonresponse choices shown for this item. Empty means no per-item skip button; voluntary ending remains available. No automatic standard checklist.",
      ),
  })
  .strict();
export const QuestionCondition = z
  .object({
    questionId: id,
    operator: z.enum([
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "includes",
      "answered",
      "nonresponse",
    ]),
    value: z.union([z.string(), z.number().finite(), z.null()]),
  })
  .strict();
export const TemporalFrame = z
  .object({
    anchor: z.enum(["session_start", "response_time", "fixed_window", "reported_event"]),
    description: short,
    from: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((frame, ctx) => {
    if (
      frame.anchor === "fixed_window" &&
      (!frame.from || !frame.until || Date.parse(frame.from) >= Date.parse(frame.until))
    )
      ctx.addIssue({ code: "custom", message: "固定参考时段需提供先后有序的起止时间。" });
    if (frame.anchor !== "fixed_window" && (frame.from || frame.until))
      ctx.addIssue({ code: "custom", message: "明确起止时间用于固定参考时段。" });
  });
export const ResearchQuestion = z
  .object({
    id,
    constructId: z.union([id, z.literal("")]),
    purpose: z.string().trim().min(1).max(500),
    kind: z.enum(["text", "single", "multiple", "select", "rating", "slider", "number"]),
    prompt: short,
    help: z.string().max(400),
    options: z.array(option),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().positive().finite(),
    lowLabel: z.string().max(80),
    highLabel: z.string().max(80),
    reverse: z.boolean(),
    responsePolicy: ResponsePolicy,
    temporal: TemporalFrame.optional(),
    applicability: z.object({ all: z.array(QuestionCondition), rationale: short }).strict(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (new Set(q.responsePolicy.options.map((o) => o.id)).size !== q.responsePolicy.options.length)
      ctx.addIssue({ code: "custom", message: "非回答选项编号必须唯一" });
    if (["single", "multiple", "select"].includes(q.kind) && q.options.length < 2)
      ctx.addIssue({ code: "custom", message: "选择题至少需要两个选项" });
    if (new Set(q.options.map((o) => o.id)).size !== q.options.length)
      ctx.addIssue({ code: "custom", message: "选项编号必须唯一" });
    if (["rating", "slider", "number"].includes(q.kind) && q.max <= q.min)
      ctx.addIssue({ code: "custom", message: "数值范围或步长无效" });
    if (["rating", "slider"].includes(q.kind) && (!q.lowLabel.trim() || !q.highLabel.trim()))
      ctx.addIssue({ code: "custom", message: "量尺必须提供两端锚点" });
    if (
      q.kind === "rating" &&
      ((q.max - q.min) / q.step > 10 || !Number.isInteger((q.max - q.min) / q.step))
    )
      ctx.addIssue({ code: "custom", message: "评分题最多11个等距刻度" });
  });
export type ResearchQuestion = z.infer<typeof ResearchQuestion>;
const ResponseCriterion = z
  .object({ minimumAnsweredFraction: z.number().min(0).max(1), essentialQuestionIds: z.array(id) })
  .strict()
  .superRefine((r, ctx) => {
    if (r.minimumAnsweredFraction === 0 && !r.essentialQuestionIds.length)
      ctx.addIssue({ code: "custom", message: "完整度规则需给出覆盖比例或必要题目。" });
  });
export const ResponseCriteria = z
  .object({ rationale: short, complete: ResponseCriterion, partial: ResponseCriterion.optional() })
  .strict()
  .superRefine((r, ctx) => {
    if (
      r.partial &&
      (r.partial.minimumAnsweredFraction > r.complete.minimumAnsweredFraction ||
        r.partial.essentialQuestionIds.some((id) => !r.complete.essentialQuestionIds.includes(id)))
    )
      ctx.addIssue({ code: "custom", message: "部分资料的要求应包含在完整资料要求内。" });
  });
export const ResearchPlan = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe(
        "Public title shown to participants. Use a short, natural, neutral phrase about the experience being discussed, suited to the audience. Put methodological and academic report labels in researcher-only fields.",
      ),
    question: short,
    topicReview: short,
    population: short.describe(
      "Researcher-only appraisal of the supplied target population, sampling scope and unresolved recruitment decisions. The public participant description uses the researcher original input. Describe uncertainties in plain language; do not infer eligibility from broad categories.",
    ),
    sampling: short,
    recruitment: short,
    welcome: short.describe(
      "Participant-facing welcome: plain-language purpose, expected time and voluntary participation. Use confirmed participation arrangements only; keep researcher review tasks and implementation details in the research methods.",
    ),
    closing: short.describe(
      "Participant-facing thanks and useful next steps, consistent with the actual application and researcher-supplied data use.",
    ),
    limitations: z.array(short).min(2).max(8),
    pilot: short,
    estimatedMinutes: z.number().positive().finite(),
    methodology: z
      .object({
        design: short,
        unitOfAnalysis: short,
        estimand: short,
        sampleSizeRationale: short,
        biasControls: short,
        validationPlan: short,
      })
      .strict(),
    constructs: z.array(
      z
        .object({
          id,
          name: z.string().min(1).max(80),
          definition: short,
          interpretation: short,
          scoring: z.enum(["items_only", "exploratory_mean"]),
          evidence: short,
        })
        .strict(),
    ),
    responseCriteria: ResponseCriteria.optional(),
    progressPolicy: z
      .object({ returnWindowHours: z.number().positive().finite(), rationale: short })
      .strict()
      .optional(),
    participationProposal: z
      .object({
        population: z.string().max(400),
        purpose: z.string().max(1000),
        eligibility: z.string().max(400),
      })
      .strict(),
    followupPolicy: z
      .object({
        enabled: z.boolean(),
        placement: z.enum(["after_core", "interleaved"]),
        coreOrder: z.enum(["fixed", "adaptive"]),
        rationale: short,
      })
      .strict(),
    questions: z.array(ResearchQuestion).min(1),
  })
  .strict()
  .superRefine((p, ctx) => {
    const ids = new Set(p.constructs.map((c) => c.id));
    if (
      ids.size !== p.constructs.length ||
      new Set(p.questions.map((q) => q.id)).size !== p.questions.length
    )
      ctx.addIssue({ code: "custom", message: "维度和问题编号必须唯一" });
    if (p.questions.some((q) => q.id.startsWith("probe_")))
      ctx.addIssue({ code: "custom", message: "核心题不能使用追问的保留编号" });
    for (const q of p.questions)
      if (q.constructId && !ids.has(q.constructId))
        ctx.addIssue({ code: "custom", message: "问题必须关联已有维度" });
    for (const c of p.constructs)
      if (
        c.scoring === "exploratory_mean" &&
        p.questions.filter((q) => q.constructId === c.id && ["rating", "slider"].includes(q.kind))
          .length < 2
      )
        ctx.addIssue({ code: "custom", message: "探索性均值至少需要两道量尺题" });
    for (const [index, q] of p.questions.entries()) {
      for (const condition of q.applicability.all) {
        const candidates =
          p.followupPolicy.coreOrder === "fixed" ? p.questions.slice(0, index) : p.questions;
        const prior = candidates.find(
          (item) => item.id === condition.questionId && item.id !== q.id,
        );
        let valid = Boolean(prior);
        if (prior) {
          const { operator, value } = condition;
          if (["gt", "gte", "lt", "lte"].includes(operator))
            valid =
              ["number", "rating", "slider"].includes(prior.kind) && typeof value === "number";
          else if (operator === "includes")
            valid = prior.kind === "multiple" && prior.options.some((o) => o.id === value);
          else if (operator === "answered") valid = value === null;
          else if (operator === "nonresponse")
            valid = prior.responsePolicy.options.some((o) => o.id === value);
          else if (["single", "select"].includes(prior.kind))
            valid = prior.options.some((o) => o.id === value);
          else if (["number", "rating", "slider"].includes(prior.kind))
            valid = typeof value === "number";
          else valid = prior.kind === "text" && typeof value === "string";
        }
        if (!valid)
          ctx.addIssue({
            code: "custom",
            path: ["questions", index, "applicability"],
            message: `题目 ${q.id} 的适用条件需使用匹配的比较值；固定题序时引用前面的题目，自适应题序时引用其他已定义题目`,
          });
      }
    }
    for (const rule of [p.responseCriteria?.complete, p.responseCriteria?.partial])
      if (rule?.essentialQuestionIds.some((id) => !p.questions.some((q) => q.id === id)))
        ctx.addIssue({
          code: "custom",
          path: ["responseCriteria"],
          message: "资料完整度规则需引用已定义的题目。",
        });
    if (!orderQuestions(p.questions))
      ctx.addIssue({
        code: "custom",
        path: ["questions"],
        message: "题目依赖需要组成无环图，并引用已定义的题目。",
      });
    for (const c of p.constructs)
      if (!p.questions.some((q) => q.constructId === c.id))
        ctx.addIssue({ code: "custom", message: "每个维度至少有一道核心题" });
  });
export type ResearchPlan = z.infer<typeof ResearchPlan>;
export const ResearchBrief = z
  .object({
    topic: z.string().trim().min(1).max(2000),
    population: z.string().trim().max(400).default(""),
    purpose: z.string().trim().max(1000).default(""),
    contact: z.string().trim().max(300).default(""),
    eligibility: z.string().trim().max(400).default(""),
    background: z.string().trim().max(12000).default(""),
    retentionDays: z
      .number()
      .int()
      .positive()
      .refine(
        (days) => Number.isFinite(new Date(Date.now() + days * 86400000).getTime()),
        "保存期限超出支持范围",
      )
      .nullable()
      .default(null),
  })
  .strict();
export type ResearchBrief = z.infer<typeof ResearchBrief>;
export const ParticipationSettings = z.object({
  population: z.string().trim().min(1).max(400),
  purpose: z.string().trim().min(1).max(1000),
  contact: z.string().trim().min(1).max(300),
  eligibility: z.string().trim().max(400),
  retentionDays: ResearchBrief.shape.retentionDays.removeDefault().unwrap(),
});
export const PlanningQuestions = z
  .array(z.object({ question: short, reason: short }).strict())
  .min(1);
export type PlanningContext = {
  exchanges: { questions: z.infer<typeof PlanningQuestions>; answer: string }[];
  sources: ResearchSource[];
  cost: number;
  revision?: { plan: ResearchPlan; instruction: string };
};
export const CollectionNoteInput = z
  .object({
    description: z.string().trim().min(1).max(2000),
    from: z.number().int().nonnegative().nullable().default(null),
    until: z.number().int().nonnegative().nullable().default(null),
  })
  .strict()
  .superRefine((note, ctx) => {
    if (note.from !== null && note.until !== null && note.from > note.until)
      ctx.addIssue({ code: "custom", message: "结束时间应晚于开始时间。" });
  });
export type CollectionNote = z.infer<typeof CollectionNoteInput> & {
  id: string;
  recordedAt: number;
};
export type ResearchSource = {
  title: string;
  url: string;
  excerpt: string;
  access: "search_excerpt" | "page_extract";
};
export type ResearchStudy = {
  id: string;
  brief: ResearchBrief;
  plan: ResearchPlan;
  sources: ResearchSource[];
  status: "draft" | "published" | "closed";
  createdAt: number;
  publishedAt?: number;
  expiresAt?: number;
  closedAt?: number;
  version: string;
  cost: number;
  model: string;
  planningContext?: PlanningContext;
  participation?: z.infer<typeof ParticipationSettings>;
  collectionNotes?: CollectionNote[];
  planAmendments?: {
    id: string;
    recordedAt: number;
    reason: string;
    model: string;
    previousPlan: ResearchPlan;
  }[];
};
export type StudyListing = { id: string; topic: string; createdAt: number };
export type ResearchPlanning = StudyListing & {
  status: "planning" | "clarifying" | "failed";
  message?: string;
  questions?: z.infer<typeof PlanningQuestions>;
  revising?: boolean;
};
export type StudySummary = StudyListing & {
  status: ResearchStudy["status"] | ResearchPlanning["status"] | "unavailable";
};
export type ResearchInspection =
  | ResearchPlanning
  | { status: "ready"; study: ResearchStudy; results: StudyResults };
export type AnswerValue = string | string[] | number | null;
export const ResearchAnswer = z
  .object({
    questionId: z.string().min(1).max(80),
    value: z.union([z.string(), z.array(z.string().max(80)), z.number().finite(), z.null()]),
    nonresponse: id.optional(),
  })
  .strict();
export type ResearchAnswer = z.infer<typeof ResearchAnswer>;
export type InterviewQuestion = ResearchQuestion & {
  source: "core" | "probe";
  referenceAt?: number;
  timeZone?: string;
};
export type InterviewAnswer = {
  question: InterviewQuestion;
  value: AnswerValue;
  nonresponse?: z.infer<typeof ResponsePolicy>["options"][number];
  at: number;
  elapsedMs: number;
  introduction: string;
  editedAt?: number;
};
export type ResearchSession = {
  id: string;
  version: string;
  startedAt: number;
  updatedAt: number;
  status: "active" | "complete";
  consentAt: number;
  timeZone?: string;
  answers: InterviewAnswer[];
  current: InterviewQuestion | null;
  message: string;
  finishReason?: "complete" | "participant" | "plan";
  invalidatedAnswers?: { answer: InterviewAnswer; at: number; reason: "routing_changed" }[];
  answerRevisions?: { before: InterviewAnswer; at: number }[];
  events?: {
    kind: "state" | "answer" | "revision" | "resume";
    at: number;
    state?: "active" | "complete";
    reason?: "complete" | "participant" | "plan";
    questionId?: string;
  }[];
  paceCheck: boolean;
  fallbackCount: number;
  cost: number;
  lease?: { token: string; until: number };
};
export type PublicStudy = {
  id: string;
  title: string;
  welcome: string;
  population: string;
  purpose: string;
  contact: string;
  estimatedMinutes: number;
  eligibility: string;
  retentionDays: number;
  available: boolean;
};
export type InterviewView = Pick<
  ResearchSession,
  "status" | "answers" | "current" | "message" | "finishReason" | "paceCheck"
> & {
  draftKey: string;
  processing: boolean;
  answeredCore: number;
  processedCore: number;
  totalCore: number;
  omitted: {
    questionId: string;
    reason: "not_applicable" | "prerequisite_missing" | "not_reached";
  }[];
};
export type ResearchResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };
export type NumericSummary = {
  n: number;
  mean: number | null;
  sd: number | null;
};
export type StudyResults = {
  sessions: number;
  completed: number;
  observedAt: number;
  ongoing: number;
  paused: number;
  unresolvedAtClose: number;
  windowElapsed: number;
  endings: { protocol: number; participant: number; plan: number };
  dispositions: {
    complete: number;
    partial: number;
    below_criteria: number;
    pending: number;
    unclassified: number;
  };
  answers: number;
  withResponses: number;
  noResponses: number;
  items: {
    id: string;
    prompt: string;
    kind: ResearchQuestion["kind"];
    n: number;
    skipped: number;
    notAsked: number;
    notApplicable: number;
    prerequisiteMissing: number;
    nonresponses: { id: string; label: string; kind: string; count: number }[];
    numeric: NumericSummary | null;
    byState: {
      state: string;
      n: number;
      nonresponse: number;
      unreached: number;
      numeric: NumericSummary | null;
    }[];
    choices: { id: string; label: string; count: number }[];
  }[];
  constructs: { id: string; name: string; items: number; summary: NumericSummary }[];
  limitations: string[];
};
