import type { ChatInput } from "./chat.js";
import type { Stats } from "./memory.js";
import type { HistoryPage } from "./messages.js";
import type { AiModelInfo } from "./models.js";
import type { Profile } from "./profile.js";
import type { SpeechPreferences } from "./speech.js";

type GenerationView = { input: ChatInput; status: "running" | "failed"; error?: string };

export type SpaceState = HistoryPage & {
  model: AiModelInfo | null;
  busy: boolean;
  generation: GenerationView | null;
  stats?: Stats;
  tts: boolean;
} & ({ profile: Profile; speech: SpeechPreferences } | { profile: null; speech: null });
