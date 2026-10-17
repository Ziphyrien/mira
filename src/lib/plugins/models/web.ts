import { defineFacet, type Facet } from "@earendil-works/chord";
import { THINKING, type AiModelInfo } from "#lib/contracts/index.js";
import { viewOf } from "#lib/app/feature.js";
import { toolbarRegistry } from "#lib/app/registries.js";

import { Images } from "#lib/plugins/images/api.js";
import { ModelPreferences } from "#lib/plugins/models/preferences.js";
import type { ModelPreferencesSnapshot } from "./ports.js";
import ThinkingControl from "#lib/plugins/models/ThinkingControl.svelte";
import { Models } from "#lib/plugins/models/api.js";

const thinkingKey = (model: AiModelInfo) => `mira:thinking:${model.provider}:${model.modelId}`;

function savedThinking(model: AiModelInfo | null) {
  if (!model) return;
  try {
    const saved = localStorage.getItem(thinkingKey(model));
    return THINKING.find((level) => level.id === saved)?.id;
  } catch {
    // Browser preferences remain optional when storage is unavailable.
  }
}

function saveThinking({ model, thinking }: ModelPreferencesSnapshot) {
  if (!model) return;
  try {
    localStorage.setItem(thinkingKey(model), thinking);
  } catch {
    // Keep the current selection usable even when the browser rejects writes.
  }
}

export function modelsWeb(model: AiModelInfo | null): Facet {
  return {
    name: "mira.web.models",
    ...defineFacet(
      (api) =>
        api.serve(
          Models,
          (_input, _principal, self) => {
            const images = self.get(Images, {});
            const preferences = self.resource("models", {
              version: 1,
              open: () => new ModelPreferences({ model, thinking: savedThinking(model) }),
              close: (owner) => owner.dispose(),
            });
            self.register(toolbarRegistry, { thinking: { order: 10, component: ThinkingControl } });
            return {
              view: viewOf<ModelPreferencesSnapshot>(() => preferences.value),
              setModel: async (model, ctx) => {
                const current = preferences.value.snapshot.model;
                preferences.value.setModel(model);
                if (current?.provider !== model?.provider || current?.modelId !== model?.modelId) {
                  const saved = savedThinking(model);
                  if (saved) preferences.value.setThinking(saved);
                }
                await images.setModel(model, ctx);
              },
              setThinking: (level) => {
                const accepted = preferences.value.setThinking(level);
                if (accepted) saveThinking(preferences.value.snapshot);
                return accepted;
              },
            };
          },
          { lifetime: "host" },
        ),
      { uses: [Images] },
    ),
  };
}
