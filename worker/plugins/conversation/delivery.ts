import type { StreamEvent } from "../../../src/lib/contracts";

/** One bounded subscriber; its lifetime never cancels the durable operation. */
export class StreamDelivery {
  private readonly stream = new TransformStream<Uint8Array, Uint8Array>();
  readonly readable = this.stream.readable;
  private readonly writer = this.stream.writable.getWriter();
  private readonly encoder = new TextEncoder();
  private readonly abort = new AbortController();
  readonly signal = this.abort.signal;
  private readonly disconnected = Promise.withResolvers<void>();
  private readonly retire = () => this.detach();
  constructor(private readonly lifetime: AbortSignal) {
    lifetime.addEventListener("abort", this.retire, { once: true });
    void this.writer.closed.catch(() => this.detach());
    if (lifetime.aborted) this.detach();
  }
  private detach() {
    if (this.signal.aborted) return;
    this.abort.abort();
    this.disconnected.resolve();
    void this.writer.abort().catch(() => {});
  }
  private async deliver(work: () => Promise<void>) {
    if (this.signal.aborted) return;
    const timer = setTimeout(() => this.detach(), 15_000);
    try {
      await Promise.race([work(), this.disconnected.promise]);
    } catch {
      this.detach();
    } finally {
      clearTimeout(timer);
    }
  }
  send = (event: StreamEvent): Promise<void> =>
    this.deliver(() => this.writer.write(this.encoder.encode(`${JSON.stringify(event)}\n`)));
  async close() {
    try {
      await this.deliver(() => this.writer.close());
    } finally {
      this.lifetime.removeEventListener("abort", this.retire);
    }
  }
}
