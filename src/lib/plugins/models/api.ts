import { local, method, opaque } from "@earendil-works/chord";
import { Type } from "typebox";
import type { AiModelInfo } from "#lib/contracts/index.js";
import { localValue, type ReadonlyView } from "#lib/app/feature.js";
import type { ModelPreferencesSnapshot, ThinkingLevel } from "#lib/plugins/models/ports.js";
export const Models = local("mira.web.models", {
  version: 1,
  input: Type.Object({}),
  members: {
    view: opaque<ReadonlyView<ModelPreferencesSnapshot>>("mira.model-view@1"),
    setModel: method(localValue<AiModelInfo | null>("mira.model-info@1"), Type.Void()),
    setThinking: method(localValue<ThinkingLevel>("mira.thinking-level@1"), Type.Boolean()),
  },
});
