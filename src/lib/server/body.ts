import { error, isHttpError } from "@sveltejs/kit";

export async function readBody(request: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get("Content-Length")) > max) error(413, "上传内容过大");
  if (!request.body) error(400, "没有上传内容");
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        error(413, "上传内容过大");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
export async function readJson(request: Request, max: number): Promise<unknown> {
  const body = await readBody(request, max);
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    error(400, "内容格式不正确");
  }
}

export function readJsonOrNull(request: Request, max: number): Promise<unknown> {
  return readJson(request, max).catch((cause: unknown) => {
    if (isHttpError(cause, 413)) throw cause;
    return null;
  });
}
