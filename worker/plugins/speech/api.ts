import { local, method } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { localValue } from "../../core/contracts";

export type SpeechResult =
  | { ok: true; audio: ReadableStream<Uint8Array> }
  | { ok: false; status: 400 | 401 | 409 | 503; message: string };

export const SpeechSynthesis = local("mira.speech.synthesis", {
  version: 1,
  input: Type.Object({}),
  members: {
    synthesize: method(
      Type.Object({ requestId: Type.String(), text: Type.String() }),
      localValue<SpeechResult>("mira.speech-stream@1"),
    ),
    cancel: method(Type.String(), Type.Void()),
  },
});
