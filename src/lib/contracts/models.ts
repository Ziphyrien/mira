import { z } from "zod";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

export const THINKING = [
  { id: "off", label: "关闭" },
  { id: "minimal", label: "极低" },
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
  { id: "xhigh", label: "极高" },
  { id: "max", label: "最高" },
] as const satisfies readonly { id: ModelThinkingLevel; label: string }[];

export const AI_PROVIDERS = [
  { id: "radius", name: "Radius" },
  { id: "deepseek", name: "DeepSeek" },
] as const;
export const KEY_PROVIDERS = [
  ...AI_PROVIDERS,
  { id: "mimo", name: "MiMo 语音" },
  { id: "tavily", name: "Tavily 搜索" },
] as const;
export type KeyProvider = (typeof KEY_PROVIDERS)[number]["id"];

export const ModelChoice = z
  .object({
    provider: z.enum(AI_PROVIDERS.map((provider) => provider.id)),
    modelId: z.string().trim().min(1).max(200),
  })
  .strict();
export type ModelChoice = z.infer<typeof ModelChoice>;
export const AiConfigInput = z
  .object({
    chat: ModelChoice,
    memory: ModelChoice,
    keys: z
      .object({
        radius: z.string().trim().min(1).max(2048).nullable().optional(),
        deepseek: z.string().trim().min(1).max(2048).nullable().optional(),
        mimo: z.string().trim().min(1).max(2048).nullable().optional(),
        tavily: z.string().trim().min(1).max(2048).nullable().optional(),
      })
      .strict(),
  })
  .strict();
export type AiModelInfo = ModelChoice & {
  name: string;
  thinking: ModelThinkingLevel[];
  highest: ModelThinkingLevel;
  supportsImages: boolean;
};
export type AiAdminState = {
  chat: ModelChoice | null;
  memory: ModelChoice | null;
  keys: Record<KeyProvider, boolean>;
  catalog: AiModelInfo[];
};
