import { defineFacet, type Facet } from "@earendil-works/chord";
import type { SpaceScope } from "../../core/storage";
import { SessionModels } from "../models/api";
import { PromptExtension } from "../prompts/api";
import { MemoryExtension } from "../memory/api";
import { SearchExtension } from "../search/api";
import { Extensions, Generation } from "./api";
import { ExtensionRegistry } from "./registry";
import { openGeneration } from "./native";
export function generationFacet(scope: SpaceScope, failed: () => void): Facet {
  return {
    name: "mira.generation",
    ...defineFacet(
      (api) =>
        api.serve(Generation, (_input, _principal, self) => {
          const models = self.get(SessionModels, {}),
            prompts = self.get(PromptExtension, {}),
            memory = self.get(MemoryExtension, {}),
            search = self.get(SearchExtension, {});
          const generationResource = self.resource("generation", {
            version: 1,
            deps: [models, prompts, memory, search],
            open: () =>
              openGeneration(
                scope,
                models.registry!.native,
                new ExtensionRegistry(api.registry(Extensions)),
                failed,
              ),
            close: (generation) => generation.close(),
          });
          return { engine: self.expose(generationResource) };
        }),
      { uses: [SessionModels, PromptExtension, MemoryExtension, SearchExtension] },
    ),
  };
}
