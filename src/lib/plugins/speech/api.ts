import { local, method, opaque } from "@earendil-works/chord";
import { Type } from "typebox";
import type { SpeechPreferences } from "#lib/contracts/index.js";
import { localValue } from "#lib/app/feature.js";
export interface SpeechView {
  report(error: string): void;
  run(work: Promise<unknown>): void;
  readonly active: boolean;
  readonly error: string;
  readonly enabled: boolean;
  readonly dictating: boolean;
  readonly preferences: SpeechPreferences;
}
export const Speech = local("mira.web.speech", {
  version: 1,
  input: Type.Object({}),
  members: {
    view: opaque<SpeechView>("mira.speech-view@1"),
    play: method(Type.String(), Type.Void()),
    stop: method(Type.Null(), Type.Void()),
    unlock: method(Type.Null(), Type.Void()),
    dictating: method(Type.Boolean(), Type.Void()),
    preferences: method(
      Type.Object({
        preferences: localValue<SpeechPreferences>("mira.speech-preferences@1"),
        enabled: Type.Optional(Type.Boolean()),
      }),
      Type.Void(),
    ),
  },
});
