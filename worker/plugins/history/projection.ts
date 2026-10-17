import type { HistoryPage, Row } from "../../../src/lib/contracts";
import type { ImageReader } from "../images/ports";
import type { MemoryReader } from "../memory/ports";
import type { ReplyReader } from "../conversation/ports";
/** Paging joins domain readers; persisted key formats belong to their stores. */
export class HistoryProjection {
  constructor(
    private readonly memory: Pick<MemoryReader, "history" | "tree" | "image">,
    private readonly images: Pick<ImageReader, "metadata" | "info" | "forUser">,
    private readonly replies: ReplyReader,
  ) {}
  rows(before: number | undefined, limit: number): Row[] {
    const rows = this.memory.history(before, limit);
    const images = this.images.metadata(
      rows.filter((row) => row.kind === "user").map((row) => row.i),
    );
    const replies = this.replies.metadata(
      rows.filter((row) => row.kind === "mira").map((row) => row.i),
    );
    return rows.map((row) => ({
      ...row,
      ...(images.has(row.i) ? { image: images.get(row.i)! } : {}),
      ...replies.get(row.i),
    }));
  }
  page(before: number | undefined, limit: number): HistoryPage {
    const rows = this.rows(before, limit + 1),
      messages = rows.slice(-limit);
    return { messages, nextBefore: rows.length > limit ? messages[0].i : null };
  }
  tree(id?: number, n?: number) {
    const tree = this.memory.tree(id, n);
    if (!tree) return null;
    const reference = id === undefined ? undefined : this.memory.image(id);
    let image;
    if (reference) image = this.images.info(reference);
    else if (id !== undefined) image = this.images.forUser(id);
    const searches =
      tree.original && id !== undefined ? this.replies.metadata([id]).get(id)?.searches : undefined;
    return {
      ...tree,
      ...(tree.original ? { original: { ...tree.original, ...(searches ? { searches } : {}), ...(image ? { image } : {}) } } : {}),
      epoch: this.replies.epoch(),
    };
  }
}
