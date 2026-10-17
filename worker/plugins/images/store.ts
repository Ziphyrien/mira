import type { Sql } from "../../core/storage";
import type { ImagePort } from "./ports";
import { Buffer } from "node:buffer";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ImageInfo } from "../../../src/lib/contracts";
import { IMAGE_MIME, MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION } from "../../../src/lib/shared/images";

function dimensions(data: ArrayBuffer): { width: number; height: number } | undefined {
  const bytes = new Uint8Array(data);
  if (
    bytes.length < 12 ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes.at(-2) !== 255 ||
    bytes.at(-1) !== 217
  )
    return;
  const view = new DataView(data);
  let at = 2;
  while (at + 4 < bytes.length) {
    if (bytes[at++] !== 255) return;
    while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (marker === 218 || marker === 217 || at + 2 > bytes.length) return;
    const length = view.getUint16(at);
    if (length < 2 || at + length > bytes.length) return;
    if (marker === 192 || marker === 193 || marker === 194) {
      if (length < 8) return;
      const height = view.getUint16(at + 3),
        width = view.getUint16(at + 5);
      if (width > 0 && height > 0 && width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION)
        return { width, height };
      return;
    }
    at += length;
  }
}

/** Private per-space assets; turn receipts and memory contain references, not pixels. */
export class Images implements ImagePort {
  constructor(private sql: Sql) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS mira_images (id TEXT PRIMARY KEY, user_id INTEGER UNIQUE, width INTEGER NOT NULL, height INTEGER NOT NULL, created INTEGER NOT NULL, data BLOB NOT NULL)",
    );
  }
  static decodeBackup(data: string): ArrayBuffer {
    if (
      data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
      data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
    )
      throw new Error("备份图片编码无效或过大");
    const decoded = Uint8Array.from(Buffer.from(data, "base64"));
    if (
      decoded.byteLength > MAX_IMAGE_BYTES ||
      Buffer.from(decoded).toString("base64") !== data ||
      !dimensions(decoded.buffer)
    )
      throw new Error("备份图片格式无效");
    return decoded.buffer;
  }
  static restore(sql: Sql, images: { id: string; userId: number; data: ArrayBuffer }[]): void {
    sql.exec("DELETE FROM mira_images");
    for (const image of images) {
      const size = dimensions(image.data)!;
      sql.exec(
        "INSERT INTO mira_images (id, user_id, width, height, created, data) VALUES (?, ?, ?, ?, ?, ?)",
        image.id,
        image.userId,
        size.width,
        size.height,
        Date.now(),
        image.data,
      );
    }
  }
  put(data: ArrayBuffer): ImageInfo | undefined {
    if (data.byteLength > MAX_IMAGE_BYTES) return;
    const size = dimensions(data);
    if (!size) return;
    const image = { id: crypto.randomUUID(), ...size };
    this.sql.exec(
      "DELETE FROM mira_images WHERE user_id IS NULL AND created < ?",
      Date.now() - 86_400_000,
    );
    this.sql.exec(
      "INSERT INTO mira_images (id, width, height, created, data) VALUES (?, ?, ?, ?, ?)",
      image.id,
      size.width,
      size.height,
      Date.now(),
      data,
    );
    return image;
  }
  pending(id: string): boolean {
    return (
      this.sql.exec("SELECT id FROM mira_images WHERE id = ? AND user_id IS NULL", id).toArray()
        .length === 1
    );
  }
  attach(id: string, userId: number): void {
    this.sql.exec(
      "UPDATE mira_images SET user_id = ? WHERE id = ? AND user_id IS NULL",
      userId,
      id,
    );
  }
  info(id: string): ImageInfo | undefined {
    return this.sql
      .exec<ImageInfo>("SELECT id, width, height FROM mira_images WHERE id = ?", id)
      .toArray()[0];
  }
  forUser(userId: number): ImageInfo | undefined {
    return this.sql
      .exec<ImageInfo>("SELECT id, width, height FROM mira_images WHERE user_id = ?", userId)
      .toArray()[0];
  }
  metadata(userIds: readonly number[]): Map<number, ImageInfo> {
    return new Map(
      this.sql
        .exec<ImageInfo & { user_id: number }>(
          "SELECT id, width, height, user_id FROM mira_images WHERE user_id IN (SELECT value FROM json_each(?))",
          JSON.stringify(userIds),
        )
        .toArray()
        .map(({ user_id, ...image }) => [user_id, image]),
    );
  }
  get(id: string): ArrayBuffer | undefined {
    return this.sql
      .exec<{ data: ArrayBuffer }>("SELECT data FROM mira_images WHERE id = ?", id)
      .toArray()[0]?.data;
  }
  content(userId: number): ImageContent | undefined {
    const row = this.sql
      .exec<{ data: ArrayBuffer }>("SELECT data FROM mira_images WHERE user_id = ?", userId)
      .toArray()[0];
    return row
      ? { type: "image", mimeType: IMAGE_MIME, data: Buffer.from(row.data).toString("base64") }
      : undefined;
  }
  *dump(): Generator<string> {
    yield "{";
    let separator = "";
    for (const row of this.sql.exec<{ id: string; data: ArrayBuffer; user_id: number }>(
      "SELECT id, data, user_id FROM mira_images WHERE user_id IS NOT NULL ORDER BY user_id",
    )) {
      yield separator + JSON.stringify(row.id) + `:{"userId":${row.user_id},"data":"`;
      const data = new Uint8Array(row.data);
      for (let at = 0; at < data.length; at += 3 * 1024 * 1024)
        yield Buffer.from(data.subarray(at, at + 3 * 1024 * 1024)).toString("base64");
      yield '"}';
      separator = ",";
    }
    yield "}";
  }
  contentById(id: string): ImageContent | undefined {
    const data = this.get(id);
    return data
      ? { type: "image", mimeType: IMAGE_MIME, data: Buffer.from(data).toString("base64") }
      : undefined;
  }
  truncate(to: number): void {
    this.sql.exec("DELETE FROM mira_images WHERE user_id >= ?", to);
  }
}
