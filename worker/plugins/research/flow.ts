import type {
  InterviewAnswer,
  ResearchQuestion,
  ResearchStudy,
  ResearchSession,
} from "../../../src/lib/contracts/research";
import { orderQuestions } from "../../../src/lib/contracts/question-graph";
type Applicability = "applicable" | "not_applicable" | "prerequisite_missing" | "pending";
function evaluate(
  q: ResearchQuestion,
  answers: Map<string, InterviewAnswer>,
  states: Map<string, Applicability>,
): Applicability {
  let unknown = false,
    pending = false;
  for (const rule of q.applicability.all) {
    const answer = answers.get(rule.questionId);
    if (!answer) {
      const state = states.get(rule.questionId);
      if (state === "not_applicable") return "not_applicable";
      if (!state || state === "prerequisite_missing") unknown = true;
      else pending = true;
      continue;
    }
    const v = answer.value;
    let matches = false;
    if (rule.operator === "nonresponse") matches = answer.nonresponse?.id === rule.value;
    else if (rule.operator === "answered") matches = v !== null;
    else {
      if (v === null) {
        unknown = true;
        continue;
      }
      switch (rule.operator) {
        case "eq":
          matches = v === rule.value;
          break;
        case "neq":
          matches = v !== rule.value;
          break;
        case "includes":
          matches = Array.isArray(v) && typeof rule.value === "string" && v.includes(rule.value);
          break;
        case "gt":
          matches = typeof v === "number" && typeof rule.value === "number" && v > rule.value;
          break;
        case "gte":
          matches = typeof v === "number" && typeof rule.value === "number" && v >= rule.value;
          break;
        case "lt":
          matches = typeof v === "number" && typeof rule.value === "number" && v < rule.value;
          break;
        case "lte":
          matches = typeof v === "number" && typeof rule.value === "number" && v <= rule.value;
          break;
      }
    }
    if (!matches) return "not_applicable";
  }
  if (unknown) return "prerequisite_missing";
  return pending ? "pending" : "applicable";
}
function evaluateGraph(questions: ResearchQuestion[], responses: InterviewAnswer[]) {
  const ordered = orderQuestions(questions);
  if (!ordered) throw new Error("Invalid published question graph");
  const states = new Map<string, Applicability>();
  const answers = new Map(responses.map((a) => [a.question.id, a]));
  for (const q of ordered) states.set(q.id, evaluate(q, answers, states));
  return { states, answers };
}
export function applicability(
  q: ResearchQuestion,
  responses: InterviewAnswer[],
  questions: ResearchQuestion[],
): Applicability {
  const { states, answers } = evaluateGraph(questions, responses);
  return evaluate(q, answers, states);
}
export function remainingQuestions(study: ResearchStudy, session: ResearchSession) {
  const { states, answers } = evaluateGraph(study.plan.questions, session.answers);
  return study.plan.questions.filter(
    (q) => !answers.has(q.id) && states.get(q.id) === "applicable",
  );
}
export function sessionCoverage(study: ResearchStudy, session: ResearchSession) {
  const { states, answers } = evaluateGraph(study.plan.questions, session.answers);
  const applicable = study.plan.questions.filter(
    (q) => answers.has(q.id) || states.get(q.id) === "applicable",
  );
  const undetermined = study.plan.questions.filter(
    (q) => !answers.has(q.id) && ["pending", "prerequisite_missing"].includes(states.get(q.id)!),
  ).length;
  const answered = session.answers.filter(
    (a) => a.question.source === "core" && a.value !== null,
  ).length;
  return {
    answered,
    knownApplicable: applicable.length,
    undetermined,
    excluded: study.plan.questions.length - applicable.length - undetermined,
    lower: applicable.length + undetermined ? answered / (applicable.length + undetermined) : null,
    upper: applicable.length ? answered / applicable.length : null,
    applicableIds: applicable.map((q) => q.id),
  };
}
export function omittedQuestions(study: ResearchStudy, session: ResearchSession) {
  const { states, answers } = evaluateGraph(study.plan.questions, session.answers);
  return study.plan.questions
    .filter((q) => !answers.has(q.id))
    .map((q) => {
      const state = states.get(q.id)!;
      return {
        questionId: q.id,
        reason: state === "applicable" || state === "pending" ? ("not_reached" as const) : state,
      };
    });
}
