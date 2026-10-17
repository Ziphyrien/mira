import type { ChatInput, ChatReply, SearchActivity } from "../../../src/lib/contracts";
import type { PromptSnapshot } from "../prompts/api";
export type Operation = {
  input: ChatInput;
  attemptId: string;
  userId: number;
  text: string;
  view: string;
  prompt?: PromptSnapshot;
  status: "running" | "failed" | "done" | "superseded" | "cancelled";
  stopRequested?: true;
  partial?: { text: string; thinking: string; at: number };
  rewindTo?: number;
  prepared?: boolean;
  error?: string;
};
export type ReplyMetadata = {
  thinking?: string;
  replyTo?: number;
  searches?: SearchActivity[];
  stopped?: true;
};
export interface ReplyReader {
  metadata(ids: readonly number[]): Map<number, ReplyMetadata>;
  epoch(): string;
}
interface SearchJournal {
  active(): Operation | undefined;
  searches(attemptId: string): SearchActivity[];
  report(activity: SearchActivity): void;
}
export interface OperationStore extends SearchJournal {
  read(id: string): Operation | undefined;
  last(): Operation | undefined;
  save(operation: Operation): void;
  begin(operation: Operation): void;
  complete(operation: Operation, reply?: ChatReply): void;
  truncate(to: number, preserveId: string): void;
  cancel(id: string): void;
  isCancelled(id: string): boolean;
  reply(id: string): ChatReply | undefined;
  replyTo(replyId: number): number | undefined;
  turn(): string | undefined;
  prepared(attemptId: string): void;
}
export interface TranscriptCursor {
  logged(): string | undefined;
  advance(id: string): void;
}
export interface ConversationPersistencePort
  extends OperationStore, ReplyReader, TranscriptCursor {}
