import { local, method, opaque } from "@earendil-works/chord";
import { Type, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import type {
  AiAdminState,
  AiModelInfo,
  KeyProvider,
  ModelChoice,
} from "../../../src/lib/contracts";
import type { PromptSnapshot } from "../prompts/api";
import { localValue } from "../../core/contracts";
export type ApiKeys = Partial<Record<KeyProvider, string>>;
export type AiConfiguration = {
  keys: ApiKeys;
  chat: ModelChoice | null;
  memory: ModelChoice | null;
};
export type SaveModelsResult = { ok: true; state: AiAdminState } | { ok: false; message: string };
export interface ChatModels {
  select(configuration: AiConfiguration): AiModelInfo | null;
}
export interface CompactionModels {
  select(configuration: AiConfiguration): {
    complete(
      context: Context,
      signal: AbortSignal,
      plan: Pick<PromptSnapshot, "sessionId" | "mode" | "thinking">,
    ): Promise<AssistantMessage>;
  };
}
export type ModelResources = { native: Models; chat: ChatModels; compaction: CompactionModels };
export class ModelSelectionError extends Error {
  override name = "ModelSelectionError";
}
export const SessionModels = local("mira.models.session", {
  version: 1,
  input: Type.Object({}),
  members: { registry: opaque<ModelResources>("mira.model-resources@1") },
});
export const ModelSettings = local("mira.models.settings", {
  version: 1,
  input: Type.Object({}),
  members: {
    configuration: method(
      Type.Null(),
      localValue<AiConfiguration>("mira.private-ai-configuration@1"),
    ),
    admin: method(Type.Null(), localValue<AiAdminState>("mira.ai-admin-state@1")),
    chatModel: method(Type.Null(), localValue<AiModelInfo | null>("mira.ai-model-info@1")),
    save: method(Type.Unknown(), localValue<SaveModelsResult>("mira.ai-save-result@1")),
  },
});
