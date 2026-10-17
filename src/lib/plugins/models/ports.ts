import type { AiModelInfo, ChatInput } from "#lib/contracts/index.js";

export type ThinkingLevel = ChatInput["thinking"];

export type ModelPreferencesSnapshot = {
  readonly model: AiModelInfo | null;
  readonly thinking: ThinkingLevel;
};
