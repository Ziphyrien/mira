import { describe, expect, it } from "vite-plus/test";
import type { AiModelInfo } from "#lib/contracts/index.js";
import { ModelPreferences } from "#lib/plugins/models/preferences.js";
import type { ModelPreferencesSnapshot } from "./ports.js";

const radiusBalanced: AiModelInfo = {
  provider: "radius",
  modelId: "balanced",
  name: "Radius Balanced",
  thinking: ["off", "low", "medium", "high", "max"],
  highest: "max",
  supportsImages: true,
};

const fastNoHigh: AiModelInfo = {
  provider: "radius",
  modelId: "fast",
  name: "Radius Fast",
  thinking: ["off", "low", "medium"],
  highest: "medium",
  supportsImages: false,
};

const deepseekPro: AiModelInfo = {
  provider: "deepseek",
  modelId: "deepseek-v4-pro",
  name: "DeepSeek Pro",
  thinking: ["off", "low", "high", "max"],
  highest: "max",
  supportsImages: false,
};

describe("ModelPreferences", () => {
  it("initializes 'high' when supported and falls back to highest when 'high' is unavailable", () => {
    const withNull = new ModelPreferences({ model: null });
    expect(withNull.snapshot).toEqual({ model: null, thinking: "off" });
    expect(Object.isFrozen(withNull.snapshot)).toBe(true);

    const withHigh = new ModelPreferences({ model: radiusBalanced });
    expect(withHigh.snapshot.thinking).toBe("high");

    const withoutHigh = new ModelPreferences({ model: fastNoHigh });
    expect(withoutHigh.snapshot.thinking).toBe("medium");
  });

  it("validates allowed levels in setThinking and preserves manual choice until provider, model, or allowed levels change", () => {
    const prefs = new ModelPreferences({ model: radiusBalanced });
    const history: ModelPreferencesSnapshot[] = [];
    const unsubscribe = prefs.subscribe((snap) => history.push(snap));

    expect(prefs.setThinking("low")).toBe(true);
    expect(prefs.snapshot.thinking).toBe("low");

    // Disallowed level for radiusBalanced ('xhigh' is not in radiusBalanced.thinking)
    expect(prefs.setThinking("xhigh")).toBe(false);
    expect(prefs.snapshot.thinking).toBe("low");

    // Same provider + modelId and 'low' still allowed -> preserves 'low'
    prefs.setModel({ ...radiusBalanced, name: "Radius Balanced Updated" });
    expect(prefs.snapshot.thinking).toBe("low");

    // Same provider + modelId, but 'low' removed from allowed levels -> resets to 'high'
    prefs.setModel({ ...radiusBalanced, thinking: ["off", "high", "max"] });
    expect(prefs.snapshot.thinking).toBe("high");

    // Manual choice 'off', then switching to another model -> resets to 'high' (or highest)
    expect(prefs.setThinking("off")).toBe(true);
    prefs.setModel(deepseekPro);
    expect(prefs.snapshot.model).toEqual(deepseekPro);
    expect(prefs.snapshot.thinking).toBe("high");

    // Switching to model without 'high' -> resets to model.highest ('medium')
    prefs.setModel(fastNoHigh);
    expect(prefs.snapshot.thinking).toBe("medium");

    unsubscribe();
    const countBefore = history.length;
    prefs.setThinking("low");
    expect(history).toHaveLength(countBefore);

    prefs.dispose();
    expect(prefs.setThinking("off")).toBe(false);
  });
});
