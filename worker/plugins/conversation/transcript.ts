import type { SpaceScope } from "../../core/storage";
import type { MemoryWriter } from "../memory/ports";
import type { CommittedTranscript } from "../generation/ports";
import type { TranscriptCursor } from "./ports";
/** Committed catch-up owns ordering and a durable cursor; native events and paging belong to generation. */
export class Transcript {
  private logging: Promise<void> = Promise.resolve();
  constructor(
    private readonly scope: SpaceScope,
    private readonly memory: MemoryWriter,
    private readonly source: CommittedTranscript,
    private readonly cursor: TranscriptCursor,
  ) {}
  sync(): Promise<void> {
    const work = this.logging.then(async () => {
      for await (const entry of this.source.entries(this.cursor.logged())) {
        if (entry.rows.length)
          this.memory.record(`entry:${entry.id}`, entry.rows, () => this.cursor.advance(entry.id));
        else this.cursor.advance(entry.id);
      }
    });
    this.logging = work.catch((error: unknown) => console.error("memory.log", error));
    return work;
  }
  async attach() {
    await this.sync();
    this.source.start(async () => {
      if (this.scope.alive) await this.sync();
    });
  }
  async close() {
    await this.source.stop();
    await this.logging;
  }
}
