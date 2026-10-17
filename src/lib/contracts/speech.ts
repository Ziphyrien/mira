import { z } from "zod";

export const VOICES = [
  { id: "mimo_default", label: "MiMo 默认" },
  { id: "冰糖", label: "冰糖 · 中文女声" },
  { id: "茉莉", label: "茉莉 · 中文女声" },
  { id: "苏打", label: "苏打 · 中文男声" },
  { id: "白桦", label: "白桦 · 中文男声" },
  { id: "Mia", label: "Mia · 英文女声" },
  { id: "Chloe", label: "Chloe · 英文女声" },
  { id: "Milo", label: "Milo · 英文男声" },
  { id: "Dean", label: "Dean · 英文男声" },
] as const;
export const SpeechPreferences = z
  .object({ voice: z.enum(VOICES.map((voice) => voice.id)), autoPlay: z.boolean() })
  .strict();
export type SpeechPreferences = z.infer<typeof SpeechPreferences>;
export const DEFAULT_SPEECH: SpeechPreferences = { voice: "冰糖", autoPlay: true };
