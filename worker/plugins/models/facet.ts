import { defineFacet, type Facet } from "@earendil-works/chord";
import type { SpaceScope } from "../../core/storage";
import { createModelRegistry, describeModel } from "./catalog";
import { SessionModels, ModelSelectionError, type ModelResources } from "./api";
export function modelsFacet(scope: SpaceScope): Facet {
  return {
    name: "mira.models",
    ...defineFacet((api) =>
      api.serve(SessionModels, (_input, _principal, self) => {
        const modelsResource = self.resource("models", {
          version: 1,
          open: async (): Promise<ModelResources> => {
            const config = await scope.directory.aiConfiguration();
            scope.assert();
            const keys = { ...config.keys },
              models = createModelRegistry(keys);
            return {
              native: models,
              compaction: {
                select: (configuration) => {
                  if (!configuration.memory || !configuration.keys[configuration.memory.provider])
                    throw new ModelSelectionError("记忆压缩模型尚未配置。");
                  const compactModels = createModelRegistry(configuration.keys);
                  const info = describeModel(compactModels, configuration.memory);
                  const model = compactModels.getModel(
                    configuration.memory.provider,
                    configuration.memory.modelId,
                  )!;
                  return {
                    complete: (context, signal, plan) => {
                      const thinking =
                        plan.thinking ?? (info.thinking.includes("high") ? "high" : info.highest);
                      return compactModels.completeSimple(model, context, {
                        signal,
                        timeoutMs: 120_000,
                        sessionId: plan.sessionId,
                        // Shared prefixes use the turn's default tool choice; compaction never executes calls.
                        ...(plan.mode === "shared" ? {} : { toolChoice: "none" as const }),
                        ...(thinking === "off" ? {} : { reasoning: thinking }),
                      });
                    },
                  };
                },
              },
              chat: {
                select: (configuration) => {
                  const info =
                    configuration.chat && configuration.keys[configuration.chat.provider]
                      ? describeModel(models, configuration.chat)
                      : null;
                  keys.radius = configuration.keys.radius;
                  keys.deepseek = configuration.keys.deepseek;
                  return info;
                },
              },
            };
          },
        });
        return { registry: self.expose(modelsResource) };
      }),
    ),
  };
}
