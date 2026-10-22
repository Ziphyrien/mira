import type { ResearchPlan, ResearchBrief, ResearchQuestion } from "../src/lib/contracts/research";
export const brief: ResearchBrief = {
  topic: "混合办公中的自主性与协作体验",
  population: "成年混合办公职员",
  purpose: "供研究团队探索工作安排与协作体验，匿名汇总报告。",
  contact: "research@example.org",
  eligibility: "年满18岁",
  background: "通过混合办公团队自愿招募。",
  retentionDays: 30,
};
const base = {
  constructId: "experience",
  purpose: "描述混合办公体验，用于探索性分析。",
  help: "请回想最近两周。",
  options: [],
  min: 1,
  max: 5,
  step: 1,
  lowLabel: "完全不符合",
  highLabel: "完全符合",
  reverse: false,
  responsePolicy: {
    rationale: "合成测试允许自主跳过，缺失不计分。",
    options: [
      { id: "skip", label: "跳过", kind: "unspecified" as const, next: "continue" as const },
    ],
  },
  applicability: { all: [], rationale: "适用于全部测试参与者。" },
};
const choices = [
  { id: "yes", label: "是" },
  { id: "no", label: "否" },
];
const questionDefinitions: ResearchQuestion[] = [
  { ...base, id: "autonomy", kind: "rating", prompt: "我能够自主安排工作时间。" },
  { ...base, id: "burden", kind: "rating", prompt: "我常被临时沟通打断。", reverse: true },
  {
    ...base,
    id: "balance",
    kind: "slider",
    prompt: "你对时间安排的满意程度？",
    min: 0,
    max: 100,
    step: 5,
    lowLabel: "完全不满意",
    highLabel: "非常满意",
  },
  { ...base, id: "hybrid", kind: "single", prompt: "上周是否有远程工作？", options: choices },
  {
    ...base,
    id: "tools",
    kind: "multiple",
    prompt: "你使用哪些沟通工具？",
    options: [
      { id: "chat", label: "文字聊天" },
      { id: "video", label: "视频会议" },
    ],
  },
  {
    ...base,
    id: "team",
    constructId: "",
    purpose: "描述样本的团队规模，用于分组汇总。",
    kind: "select",
    prompt: "你的团队规模？",
    options: [
      { id: "small", label: "少于10人" },
      { id: "large", label: "10人及以上" },
    ],
  },
  { ...base, id: "days", kind: "number", prompt: "上周远程工作了几天？", min: 0, max: 7 },
  { ...base, id: "context", kind: "text", prompt: "有什么情境能帮助我们理解你的工作体验？" },
];
export const questions = questionDefinitions.map((q) => structuredClone(q));
export const plan: ResearchPlan = {
  title: "混合办公体验研究",
  estimatedMinutes: 10,
  question: "混合办公中的自主安排与协作负担有什么关联？",
  topicReview: "采用描述性关联设计，不推断因果。",
  population: brief.population,
  sampling: "便利招募，样本量预算10人；正式研究需功效分析。",
  recruitment: "通过团队自愿招募，不由直属主管追踪参与。",
  welcome: "想听听你的混合办公体验。约10分钟，每题都可以跳过。",
  closing: "谢谢你的分享，这次访谈已经结束。",
  limitations: ["便利样本不能代表所有职员。", "探索性指标未经效度验证。"],
  pilot: "先进行认知访谈与小样本预试，再检验结构和测量等值性。",
  methodology: {
    design: "横断面探索性混合方法研究。",
    unitOfAnalysis: "成年职员个体。",
    estimand: "当前参与样本的体验分布。",
    sampleSizeRationale: "10人为测试预算，正式推断按精度和设计规划。",
    biasControls: "自愿参加，按团队结构评估相关性。",
    validationPlan: "目标人群认知预试、内容审查、结构与信效度验证。",
  },
  constructs: [
    {
      id: "experience",
      name: "工作体验",
      definition: "对自主安排与协作负担的主观体验。",
      scoring: "exploratory_mean",
      evidence: "合成测试题，用于核验固定计分和数据流。",
      interpretation: "评分是探索性描述，不用于个人评估。",
    },
  ],
  participationProposal: { population: brief.population, purpose: brief.purpose, eligibility: "" },
  followupPolicy: {
    enabled: true,
    placement: "after_core",
    coreOrder: "fixed",
    rationale: "测试访谈允许澄清经历。",
  },
  questions,
};
