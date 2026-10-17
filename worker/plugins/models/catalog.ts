import { createModels, getSupportedThinkingLevels } from "@earendil-works/pi-ai/models";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { radiusProvider } from "@earendil-works/pi-ai/providers/radius";
import type { AiModelInfo, ModelChoice } from "../../../src/lib/contracts";
import { ModelSelectionError, type ApiKeys } from "./api";
/** Only the built-in providers own endpoints, auth headers and wire parameters. */
export function createModelRegistry(keys: ApiKeys) {
  const models = createModels({
    authContext: {
      env: async (name) => {
        if (name === "RADIUS_API_KEY") return keys.radius;
        if (name === "DEEPSEEK_API_KEY") return keys.deepseek;
        return undefined;
      },
      fileExists: async () => false,
    },
  });
  models.setProvider(radiusProvider());
  models.setProvider(deepseekProvider());
  return models;
}

export function describeModel(
  models: ReturnType<typeof createModelRegistry>,
  choice: ModelChoice,
): AiModelInfo {
  const model = models.getModel(choice.provider, choice.modelId);
  if (!model) throw new ModelSelectionError("找不到所选模型，请重新选择。");
  const thinking = getSupportedThinkingLevels(model);
  const highest = thinking.at(-1);
  if (!highest) throw new ModelSelectionError("所选模型没有可用的思考档位。");
  return {
    ...choice,
    name: model.name,
    thinking,
    highest,
    supportsImages: model.input.includes("image"),
  };
}
