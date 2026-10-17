import type { Profile, ModelChoice } from "../../../src/lib/contracts";
import { profileDescription } from "../profile/api";
import { MEMORY_TOOLS } from "../memory/api";
import { SEARCH_TOOL, SEARCH_INSTRUCTIONS } from "../search/api";
import type { PromptRequest, PromptSnapshot } from "./api";
import { MEMORY_FORMAT, MEMORY_NAVIGATION, TURN_RULES, COMPACTION_RULES } from "./templates";

export function sameModel(
  a: ModelChoice | null | undefined,
  b: ModelChoice | null | undefined,
): boolean {
  return Boolean(a && b && a.provider === b.provider && a.modelId === b.modelId);
}

export function composePrompt(
  request: PromptRequest,
  profile?: Profile,
): Omit<PromptSnapshot, "sessionId"> {
  const mode = sameModel(request.models.chat, request.models.memory) ? "shared" : "separate";
  const model = request.purpose === "turn" ? request.models.chat : request.models.memory;
  if (!model) throw new Error("Prompt model is not configured");
  const acts = mode === "shared" || request.purpose === "turn";
  const summarizes = mode === "shared" || request.purpose === "compaction";
  if (acts && !profile) throw new Error("Profile is not configured");
  let identity =
    'You write Mira\'s memory. Each call is a compaction: the view below is followed by a task starting "Compaction:".';
  if (acts)
    identity =
      "You are Mira, an AI agent that works for one user in a single chat that never ends.\n" +
      (mode === "shared"
        ? 'Each call is a turn or a compaction: the view below is followed by the user\'s new message, or by a task starting "Compaction:".'
        : "The view below is followed by the user's new message.");
  const sections = [identity, MEMORY_FORMAT];
  if (acts) sections.push(MEMORY_NAVIGATION, TURN_RULES, SEARCH_INSTRUCTIONS);
  if (summarizes) sections.push(COMPACTION_RULES);
  if (acts) sections.push(profileDescription(profile!));
  return {
    version: 1,
    mode,
    model: { ...model },
    system: sections.join("\n\n"),
    tools: acts ? structuredClone([...MEMORY_TOOLS, SEARCH_TOOL]) : [],
    ...(request.thinking === undefined ? {} : { thinking: request.thinking }),
    ...(acts ? { timezone: profile!.timezone } : {}),
  };
}
