import { z } from "zod";
import type { AiConfiguration } from "../models/api";
import { createModelRegistry, getSupportedThinkingLevels } from "../models/ports";
import {
  ResearchPlan,
  ResearchQuestion,
  PlanningQuestions,
  type PlanningContext,
  type ResearchBrief,
  type ResearchSource,
  type ResearchStudy,
  type ResearchSession,
} from "../../../src/lib/contracts/research";

import { remainingQuestions } from "./flow";
import { PLAN_INSTRUCTIONS, PLANNING_INSTRUCTIONS, INTERVIEW_INSTRUCTIONS } from "./prompts";

const METHOD_GUIDANCE = [
  {
    citation:
      "Sischka et al., doi:10.1177/0894439320907067; questionnaire design experiment, doi:10.1080/13645579.2021.1929714",
    finding:
      "Forced answering can increase reactance and breakoff; explicit nonresponse options also change response behavior. Select item-specific nonresponse choices for measurement reasons instead of applying a universal mandatory or optional rule. Findings depend on populations and question formats.",
  },
  {
    citation: "Interactive requests experiment (2025), doi:10.1017/S0007123424000747",
    finding:
      "In ten-country opt-in panels, interactive requests reduced missingness for some items; effects varied and knowledge-item accuracy cannot establish truthfulness of psychological reports. Respect explicit refusals, preserve genuine uncertainty, and pilot any prompts in the intended population.",
  },
  {
    citation: "VanderWeele (2019), doi:10.1007/s10654-019-00494-6",
    finding:
      "Covariate selection for causal estimation needs substantive and temporal knowledge. Availability or statistical association alone cannot distinguish confounding, mediation and collider bias. This is guidance for causal adjustment, not a mandatory background-variable checklist.",
  },
  {
    citation: "Altman & Royston (2006), doi:10.1136/bmj.332.7549.1080",
    finding:
      "Dichotomising quantitative data loses information, can hide nonlinear relationships and can leave residual confounding. Preserve useful measurement resolution; grouping for presentation and choosing collection precision are different decisions. The paper focuses on dichotomisation, not a ban on every categorical response.",
  },
  {
    citation: "Artino et al. (2014), doi:10.3109/0142159X.2014.889814",
    finding:
      "Define intended constructs and uses, review prior instruments, seek target-population perspectives, review content, cognitively pretest and pilot. Validity evidence depends on population, context and intended interpretation. Medical-education scale guidance does not cover all survey designs.",
  },
  {
    citation: "Boateng et al. (2018), doi:10.3389/fpubh.2018.00149",
    finding:
      "Develop constructs and content coverage first; combine expert and target-population review, cognitive pretesting, item and dimensional analysis, reliability and validity evaluation. Sample size depends on the model and population. Scoring must follow a defensible dimensional structure. The paper is a methodological primer, not validation of any generated instrument.",
  },
  {
    citation: "DeJonckheere & Vaughn (2019), doi:10.1136/fmch-2018-000057",
    finding:
      "State purpose and expected time, begin with easy context, listen to the participant perspective, ask clear neutral probes, pilot the guide and record the process. Evidence primarily concerns human face-to-face qualitative interviews; digital AI application requires its own pilot.",
  },
  {
    citation: "Cernat et al. (2022), doi:10.1177/00491241221140139",
    finding:
      "EVS Germany compared 59-minute face-to-face, 55-minute long mixed-mode and 38-minute matrix mixed-mode questionnaires. Most but not all scales achieved metric/scalar equivalence. Length and mode effects were context dependent; these results justify testing equivalence and burden, not a universal time cutoff.",
  },
];
export class ResearchError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export type AgentDecision = {
  intro: string;
  action: "core" | "probe" | "finish";
  probe?: z.infer<typeof ResearchQuestion>;
  checkInQuote?: string;
  questionId?: string;
};
export interface ResearchAgent {
  plan(
    brief: ResearchBrief,
    studyId: string,
    signal?: AbortSignal,
    context?: PlanningContext,
  ): Promise<
    ({ plan: ResearchPlan } | { clarifications: z.infer<typeof PlanningQuestions> }) & {
      sources: ResearchSource[];
      cost: number;
      model: string;
    }
  >;
  next(
    study: ResearchStudy,
    session: ResearchSession,
  ): Promise<{ decision: AgentDecision; cost: number }>;
}
function requestSignal(timeout: number, cancellation?: AbortSignal) {
  const deadline = AbortSignal.timeout(timeout);
  return cancellation ? AbortSignal.any([deadline, cancellation]) : deadline;
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Empty response");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let body = "",
    size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512000) {
        await reader.cancel();
        throw new Error("Response too large");
      }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
export function createResearchAgent(configuration: () => Promise<AiConfiguration>): ResearchAgent {
  async function generate<T>(
    config: AiConfiguration,
    system: string,
    input: Record<string, unknown>,
    shape: z.ZodType<T>,
    studyId: string,
    interview = false,
    cancellation?: AbortSignal,
  ) {
    const choice = config.chat;
    if (!choice || !config.keys[choice.provider])
      throw new ResearchError(503, "请先在管理员设置中配置聊天模型。");
    const models = createModelRegistry(config.keys),
      model = models.getModel(choice.provider, choice.modelId);
    if (!model) throw new ResearchError(503, "当前模型不可用。");
    const levels = getSupportedThinkingLevels(model);
    if (!levels.includes("high"))
      throw new ResearchError(503, "请选择支持 high 思考等级的研究模型。");
    const highest = levels.at(-1);
    let reasoning = highest === "off" ? undefined : highest;
    if (interview) reasoning = "high";
    const schema = JSON.stringify(z.toJSONSchema(shape));
    let cost = 0;
    let validationFeedback: { path: string; requirement: string }[] = [];
    const signal = requestSignal(interview ? 45000 : 720000, cancellation);
    for (let attempt = 0; attempt < (interview ? 1 : 2); attempt++) {
      const startedAt = Date.now();
      const reply = await models.completeSimple(
        model,
        {
          systemPrompt: system + "\nReturn a JSON object matching this schema: " + schema,
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                ...input,
                ...(validationFeedback.length ? { validationFeedback } : {}),
              }),
              timestamp: 0,
            },
          ],
        },
        {
          signal,
          maxTokens: model.maxTokens,
          reasoning,
          toolChoice: "none",
          sessionId: "mira-research-v1",
        },
      );
      cost += reply.usage.cost.total;
      const upstreamStatus = reply.errorMessage?.match(/\b(4\d{2}|5\d{2})\b/)?.[1];
      let errorKind: string | undefined;
      if (reply.errorMessage) {
        errorKind = "upstream";
        if (/timeout|timed out|abort/i.test(reply.errorMessage)) errorKind = "timeout";
        else if (/rate.limit|429/i.test(reply.errorMessage)) errorKind = "rate_limit";
        else if (/auth|401|403/i.test(reply.errorMessage)) errorKind = "authentication";
        else if (/network|connection|fetch failed|socket|terminated/i.test(reply.errorMessage))
          errorKind = "connection";
      }
      console.info(
        "research.model",
        JSON.stringify({
          studyId,
          attempt: attempt + 1,
          phase: interview ? "interview" : "plan",
          provider: choice.provider,
          model: choice.modelId,
          reasoning,
          elapsedMs: Date.now() - startedAt,
          stopReason: reply.stopReason,
          inputTokens: reply.usage.input,
          outputTokens: reply.usage.output,
          errorKind,
          upstreamStatus,
        }),
      );
      if (reply.stopReason !== "stop") {
        let message = upstreamStatus
          ? `模型服务返回错误（HTTP ${upstreamStatus}），请稍后重试或检查模型配置。`
          : "模型服务未正常完成请求，请稍后重试。";
        if (reply.stopReason === "length") message = "模型输出达到生成长度上限，请重试。";
        else if (reply.stopReason === "aborted" || errorKind === "timeout")
          message = "模型生成超时，请稍后重试。";
        else if (errorKind === "rate_limit") message = "模型服务当前请求过多，请稍后重试。";
        else if (errorKind === "authentication")
          message = "模型服务认证或权限失败，请检查管理员中的模型配置。";
        else if (errorKind === "connection") message = "与模型服务的连接中断，请稍后重试。";
        throw new ResearchError(502, message);
      }
      const text = reply.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim()
        .replace(/^```(?:json)?\s*|\s*```$/g, "");
      try {
        return {
          data: shape.parse(JSON.parse(text)),
          cost,
          model: choice.provider + "/" + choice.modelId,
        };
      } catch (error) {
        validationFeedback =
          error instanceof z.ZodError
            ? error.issues
                .slice(0, 12)
                .map((issue) => ({ path: issue.path.join("."), requirement: issue.message }))
            : [{ path: "", requirement: "Return a complete, syntactically valid JSON object." }];
        if (interview || attempt === 1)
          throw new ResearchError(502, "研究助手返回的方案未通过校验，请重试。");
      }
    }
    throw new Error("Unreachable");
  }
  async function interviewConfiguration(study: ResearchStudy): Promise<AiConfiguration> {
    const config = await configuration();
    const split = study.model.indexOf("/");
    const provider = study.model.slice(0, split),
      modelId = study.model.slice(split + 1);
    if ((provider !== "radius" && provider !== "deepseek") || !modelId)
      throw new ResearchError(503, "请联系研究者检查本研究的模型设置。");
    return { ...config, chat: { provider, modelId } };
  }
  return {
    async plan(brief, studyId, cancellation, context) {
      const config = await configuration();
      const signal = requestSignal(720000, cancellation);
      const sources: ResearchSource[] = structuredClone(context?.sources ?? []);
      const notes: string[] = [];
      let cost = 0;
      const actionShape = z.discriminatedUnion("action", [
        z
          .object({ action: z.literal("search"), query: z.string().trim().min(1).max(600) })
          .strict(),
        z
          .object({ action: z.literal("read"), urls: z.array(z.string().url()).min(1).max(6) })
          .strict(),
        z.object({ action: z.literal("clarify"), questions: PlanningQuestions }).strict(),
        z.object({ action: z.literal("draft") }).strict(),
      ]);
      const evidence = () =>
        sources.map((s) => ({
          ...s,
          excerpt: s.excerpt.slice(0, Math.floor(80000 / Math.max(1, sources.length))),
        }));
      const task = {
        brief,
        exchanges: context?.exchanges ?? [],
        revision: context?.revision,
        methodGuidance: METHOD_GUIDANCE,
      };
      const queries = new Set<string>();
      for (let step = 0; step < 12; step++) {
        signal.throwIfAborted();
        const choice = await generate(
          config,
          PLANNING_INSTRUCTIONS,
          { ...task, sources: evidence(), toolNotes: notes, actionsRemaining: 12 - step },
          actionShape,
          studyId,
          false,
          signal,
        );
        cost += choice.cost;
        const action = choice.data;
        if (action.action === "clarify")
          return { clarifications: action.questions, sources, cost, model: choice.model };
        if (action.action === "draft") {
          if (sources.length) break;
          notes.push("Collect relevant source evidence before drafting.");
          continue;
        }
        if (!config.keys.tavily)
          throw new ResearchError(503, "请先在管理员模型设置中配置 Tavily，以便查阅研究依据。");
        const headers = {
          Authorization: `Bearer ${config.keys.tavily}`,
          "Content-Type": "application/json",
        };
        if (action.action === "search") {
          if (queries.has(action.query) || sources.length >= 24) {
            notes.push("Use the collected evidence or choose a more specific unresolved question.");
            continue;
          }
          queries.add(action.query);
          const response = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers,
            signal: requestSignal(15000, signal),
            body: JSON.stringify({
              query: action.query,
              search_depth: "advanced",
              max_results: 4,
              include_answer: false,
              include_raw_content: false,
            }),
          });
          if (!response.ok) {
            await response.body?.cancel();
            notes.push(
              `Search unavailable (HTTP ${response.status}); assess existing evidence or another query.`,
            );
            continue;
          }
          const result = z
            .object({
              results: z.array(
                z.object({ url: z.string(), title: z.string(), content: z.string() }),
              ),
            })
            .parse(await boundedJson(response));
          for (const r of result.results)
            if (
              /^https?:\/\//.test(r.url) &&
              !sources.some((s) => s.url === r.url) &&
              sources.length < 24
            )
              sources.push({
                url: r.url,
                title: r.title.slice(0, 200),
                excerpt: r.content.slice(0, 2000),
                access: "search_excerpt",
              });
          notes.push(`Search completed: ${action.query}; ${result.results.length} results.`);
        } else {
          const urls = action.urls.filter((url) => sources.some((s) => s.url === url));
          if (!urls.length) {
            notes.push("Select URLs from discovered sources for reading.");
            continue;
          }
          try {
            const response = await fetch("https://api.tavily.com/extract", {
              method: "POST",
              headers,
              signal: requestSignal(20000, signal),
              body: JSON.stringify({
                urls,
                query: brief.topic.slice(0, 500),
                extract_depth: "advanced",
              }),
            });
            if (!response.ok) {
              await response.body?.cancel();
              notes.push(
                `Page extraction unavailable (HTTP ${response.status}); excerpts remain labeled.`,
              );
              continue;
            }
            const extracted = z
              .object({ results: z.array(z.object({ url: z.string(), raw_content: z.string() })) })
              .parse(await boundedJson(response));
            for (const r of extracted.results) {
              const source = sources.find((s) => s.url === r.url);
              if (source && r.raw_content.trim()) {
                source.excerpt = r.raw_content.slice(0, 14000);
                source.access = "page_extract";
              }
            }
            notes.push(`Read completed for ${extracted.results.length} sources.`);
          } catch {
            signal.throwIfAborted();
            notes.push("Page extraction unavailable; assess the available search excerpts.");
          }
        }
      }
      if (!sources.length)
        throw new ResearchError(502, "暂未获得可核对的研究依据，请补充背景或稍后重试。");
      const result = await generate(
        config,
        PLAN_INSTRUCTIONS,
        { ...task, sources: evidence(), toolNotes: notes },
        ResearchPlan,
        studyId,
        false,
        signal,
      );
      return { plan: result.data, sources, cost: cost + result.cost, model: result.model };
    },
    async next(study, session) {
      const remaining = remainingQuestions(study, session);
      const common = {
        intro: z.string().min(1).max(300),
        checkInQuote: z.string().min(4).max(120).optional(),
      };
      const policy = study.plan.followupPolicy;
      const core =
        policy.coreOrder === "adaptive" && remaining.length
          ? z
              .object({
                ...common,
                action: z.literal("core"),
                questionId: z.enum(remaining.map((q) => q.id)),
              })
              .strict()
          : z.object({ ...common, action: z.literal("core") }).strict();
      const probe = z
        .object({ ...common, action: z.literal("probe"), probe: ResearchQuestion })
        .strict();
      const finish = z.object({ ...common, action: z.literal("finish") }).strict();
      let shape: z.ZodType<AgentDecision> = core;
      if (!remaining.length) shape = z.union([finish, probe]);
      else if (policy.enabled && policy.placement === "interleaved") shape = z.union([core, probe]);
      const result = await generate<AgentDecision>(
        await interviewConfiguration(study),
        INTERVIEW_INSTRUCTIONS,
        {
          studyContext: {
            question: study.plan.question,
            population: study.participation?.population ?? study.brief.population,
            constructs: study.plan.constructs,
            followupPolicy: study.plan.followupPolicy,
          },
          currentQuestion: remaining[0],
          eligibleQuestions:
            study.plan.followupPolicy.coreOrder === "adaptive" ? remaining : undefined,
          remaining: remaining.map((q) => q.id),
          answers: session.answers
            .filter((a) => a.value !== null)
            .map((a) => ({
              questionId: a.question.id,
              prompt: a.question.prompt,
              kind: a.question.kind,
              options: a.question.options,
              value: a.value,
              temporal: a.question.temporal,
              referenceAt: a.question.referenceAt,
              submittedAt: a.at,
              editedAt: a.editedAt,
            })),
          latestRevision: session.answers
            .filter((a) => a.editedAt)
            .sort((a, b) => (b.editedAt ?? 0) - (a.editedAt ?? 0))[0]?.question.id,
          followupsUsed: session.answers.filter((a) => a.question.source === "probe").length,
          timing: {
            elapsedSeconds: Math.round((Date.now() - session.startedAt) / 1000),
            estimatedMinutes: study.plan.estimatedMinutes,
          },
        },
        shape,
        study.id,
        true,
      );
      return { decision: result.data, cost: result.cost };
    },
  };
}
