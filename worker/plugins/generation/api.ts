import { defineRegistry, local, opaque } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import type { Extension } from "@earendil-works/pi-durable";
import type { TurnGeneration, CommittedTranscript, GenerationUsage } from "./ports";
export const Extensions = defineRegistry<{ order: number; extension: Extension }>(
  "mira.extensions",
  { conflict: "error" },
);
export type GenerationPorts = {
  turn: TurnGeneration;
  transcript: CommittedTranscript;
  usage: GenerationUsage;
};
export const Generation = local("mira.generation", {
  version: 1,
  input: Type.Object({}),
  members: { engine: opaque<GenerationPorts>("mira.generation-ports@1") },
});
