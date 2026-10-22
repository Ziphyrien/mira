import type { ResearchStudy, ResearchSession } from "../../../src/lib/contracts/research";
import { sessionCoverage } from "./flow";
import type { PagePresence } from "../../../src/lib/contracts/research-presence";
export function recordState(
  s: ResearchSession,
  state: ResearchSession["status"],
  reason: ResearchSession["finishReason"],
  at: number,
) {
  const previous = s.events?.filter((e) => e.kind === "state").at(-1);
  if (previous?.state !== state || previous.reason !== reason)
    (s.events ??= []).push({ kind: "state", state, reason, at });
  s.status = state;
  s.finishReason = reason;
}
export function observeSession(
  study: ResearchStudy,
  s: ResearchSession,
  observedAt: number,
  presence?: PagePresence,
) {
  const cutoff = Math.min(observedAt, study.closedAt ?? Infinity, study.expiresAt ?? Infinity);
  const collectionOpen =
    study.status === "published" && Boolean(study.expiresAt && observedAt < study.expiresAt);
  const event = s.events?.filter((e) => e.kind === "state" && e.at <= cutoff).at(-1);
  const recordedState = event?.state ?? s.status;
  const processing = Boolean(s.lease && s.lease.until > observedAt);
  const ended = recordedState === "complete" && !processing;
  const reason = event?.reason ?? s.finishReason;
  let state: "ended" | "ongoing" | "paused" = "paused";
  if (ended || !collectionOpen) state = "ended";
  else if (presence?.state === "foreground") state = "ongoing";
  let endReason: "participant" | "plan" | "protocol" | "collection_closed" | "inactivity" | null =
    null;
  if (ended) {
    endReason = reason === "participant" || reason === "plan" ? reason : "protocol";
  } else if (!collectionOpen) endReason = "collection_closed";
  const endedAt = ended && event?.state === "complete" ? event.at : null;
  const actionTimes = [
    s.startedAt,
    ...s.answers.flatMap((a) => [a.at, ...(a.editedAt ? [a.editedAt] : [])]),
    ...(s.events ?? []).filter((e) => e.kind === "resume").map((e) => e.at),
  ].filter((at) => at <= cutoff);
  const lastActionAt = actionTimes.reduce((latest, at) => Math.max(latest, at), s.startedAt);
  const returnWindowUntil = study.plan.progressPolicy
    ? lastActionAt + study.plan.progressPolicy.returnWindowHours * 3600000
    : null;
  const windowElapsed =
    state === "paused" && returnWindowUntil !== null && cutoff >= returnWindowUntil;
  if (windowElapsed) {
    state = "ended";
    endReason = "inactivity";
  }
  const coverage = sessionCoverage(study, s);
  let disposition: "pending" | "unclassified" | "complete" | "partial" | "below_criteria" =
    "unclassified";
  const rules = study.plan.responseCriteria;
  if (state === "ongoing" || state === "paused") disposition = "pending";
  else if (rules && coverage.undetermined === 0 && coverage.upper !== null) {
    const meets = (rule: typeof rules.complete) =>
      coverage.upper! >= rule.minimumAnsweredFraction &&
      rule.essentialQuestionIds.every(
        (id) =>
          !coverage.applicableIds.includes(id) ||
          s.answers.some((a) => a.question.id === id && a.value !== null),
      );
    if (meets(rules.complete)) disposition = "complete";
    else if (rules.partial && meets(rules.partial)) disposition = "partial";
    else disposition = "below_criteria";
  }
  return {
    observedAt,
    observationCutoff: cutoff,
    state,
    endReason,
    windowElapsed,
    unresolvedAtClose: !ended && !collectionOpen,
    returnWindowUntil,
    processing,
    analysisRuleTiming: study.planAmendments?.length
      ? "amended_after_collection_started"
      : "published_plan",
    endedAt,
    observedDurationMs: Math.max(0, (endedAt ?? cutoff) - s.startedAt),
    lastActionAt,
    sinceLastActionMs: Math.max(0, cutoff - lastActionAt),
    eventHistoryComplete: s.events?.[0]?.kind === "state" && s.events[0].at === s.startedAt,
    coverage,
    disposition,
  };
}
