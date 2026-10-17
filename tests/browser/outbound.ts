import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Headers, Request, type Response } from "miniflare";

/** Miniflare's fetcher bridge omits disconnect signals; use the actual HTTP connection here. */
export function outboundHandler(fetch: (request: Request) => Promise<Response>) {
  return async (incoming: IncomingMessage, outgoing: ServerResponse) => {
    const controller = new AbortController();
    outgoing.once("close", () => {
      if (!outgoing.writableFinished) controller.abort();
    });
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) for (const item of value) headers.append(name, item);
      else if (value !== undefined) headers.set(name, value);
    }
    const request = new Request(new URL(incoming.url!, `http://${headers.get("host")}`), {
      method: incoming.method,
      headers,
      body:
        incoming.method === "GET" || incoming.method === "HEAD"
          ? undefined
          : Readable.toWeb(incoming),
      duplex: "half",
      signal: controller.signal,
    });
    try {
      const response = await fetch(request);
      if (controller.signal.aborted) {
        await response.body?.cancel();
        return;
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body)
        await pipeline(Readable.fromWeb(response.body), outgoing, { signal: controller.signal });
      else outgoing.end();
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("Synthetic upstream failed", error);
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
    }
  };
}
