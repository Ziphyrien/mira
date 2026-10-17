import { local, method } from "@earendil-works/chord";
import { Type, type Tool, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelChoice } from "../../../src/lib/contracts";
import type { AiConfiguration } from "../models/api";
import { localValue } from "../../core/contracts";

export type PromptRequest = {
  purpose: "turn" | "compaction";
  models: Pick<AiConfiguration, "chat" | "memory">;
  thinking?: ModelThinkingLevel;
};
export type PromptSnapshot = {
  version: 1;
  mode: "shared" | "separate";
  model: ModelChoice;
  system: string;
  tools: Tool[];
  sessionId: string;
  thinking?: ModelThinkingLevel;
  timezone?: string;
};
export interface PromptPlanner {
  create(request: PromptRequest): Promise<PromptSnapshot>;
}
export const PromptPlans = local("mira.prompts.plans", {
  version: 1,
  input: Type.Object({}),
  members: {
    create: method(
      localValue<PromptRequest>("mira.prompt-request@1"),
      localValue<PromptSnapshot>("mira.prompt-snapshot@1"),
    ),
  },
});
export const PromptExtension = local("mira.prompts.extension", {
  version: 1,
  input: Type.Object({}),
});
