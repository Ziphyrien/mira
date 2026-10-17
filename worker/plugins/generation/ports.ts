import type { ChatInput } from "../../../src/lib/contracts";
import type { LogMessage } from "../memory/ports";
export type LiveGeneration = {
  busy: boolean;
  taskId?: number;
  message?: { text: string; thinking: string };
  recalling: boolean;
};
interface GenerationWatch {
  start(listener: (live: LiveGeneration) => Promise<void>): void;
  stop(): Promise<void>;
}
export interface TurnGeneration {
  prepare(input: {
    model: ChatInput["model"];
    thinking: ChatInput["thinking"];
    sessionId: string;
    reset: boolean;
  }): Promise<void>;
  submit(text: string, attemptId: string): Promise<{ wait(): Promise<boolean> }>;
  resume(): void;
  abort(): Promise<void>;
  idle(): Promise<void>;
  live(): Promise<LiveGeneration>;
  watch(): Promise<GenerationWatch | undefined>;
  answer(): Promise<{ text: string; thinking: string; complete: boolean }>;
}
export interface CommittedTranscript {
  entries(after: string | undefined): AsyncIterable<{ id: string; rows: LogMessage[] }>;
  start(listener: () => Promise<void>): void;
  stop(): Promise<void>;
}
export interface GenerationUsage {
  cost(): Promise<number>;
}
