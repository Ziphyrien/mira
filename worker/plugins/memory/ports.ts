import type { MemoryTreePage } from "../../../src/lib/contracts";
import type { ReplyMetadata } from "../conversation/ports";
import type { Stats } from "../../../src/lib/contracts/memory";
export type Kind = "user" | "mira" | "tool" | "echo" | "work" | "note";
export type LogMessage = { kind: Kind; text: string; date?: number; image?: string };
export type Compact = (context: string, task: string, signal: AbortSignal) => Promise<string>;
type MemoryRow = { i: number; kind: "user" | "mira"; text: string; at: number };
export type MemoryLine = { start: number; count: number; text: string };
export interface MemoryReader {
  readonly revision: number;
  history(before: number | undefined, limit: number): MemoryRow[];
  tree(id?: number, n?: number): MemoryTreePage | null;
  stats(): Stats;
  render(): string;
  lines(): MemoryLine[];
  zoom(id: number, n: number, at?: number): string;
  image(id: number): string | undefined;
  dump(
    imageForUser?: (id: number) => string | undefined,
    replyForMessage?: (id: number) => ReplyMetadata | undefined,
  ): Generator<string>;
  date(id: number, timeZone: string): string;
}
export interface MemoryWriter {
  record(source: string, messages: readonly LogMessage[], commit?: () => void): boolean;
  append(kind: Kind, text: string, commit?: () => void): number;
}
export interface TurnMemory extends MemoryWriter {
  input(source: string): { i: number; text: string } | undefined;
  user(i: number): { i: number; text: string } | undefined;
  history(before: number | undefined, limit: number): MemoryRow[];
  render(): string;
  renderBefore(i: number): string;
  rewind(to: number, branch: string, commit: () => void): Promise<void>;
  freeze(view: string | undefined): void;
  prepare(ms: number): Promise<boolean>;
}
export interface MemoryMaintenance {
  pump(): void;
  settle(ms: number): Promise<boolean>;
  working(): boolean;
  close(): void;
}
interface MemoryContext {
  frozen(): string;
}
export interface MemoryPort extends MemoryReader, TurnMemory, MemoryMaintenance, MemoryContext {}
