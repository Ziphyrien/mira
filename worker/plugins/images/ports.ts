import type { ImageContent } from "@earendil-works/pi-ai";
import type { ImageInfo } from "../../../src/lib/contracts";
export interface ImageReader {
  info(id: string): ImageInfo | undefined;
  metadata(userIds: readonly number[]): Map<number, ImageInfo>;
  forUser(userId: number): ImageInfo | undefined;
}
export interface TurnImages extends ImageReader {
  pending(id: string): boolean;
  attach(id: string, userId: number): void;
}
export interface ImageRewind {
  truncate(to: number): void;
}
export interface ImagePort extends TurnImages, ImageRewind {
  put(data: ArrayBuffer): ImageInfo | undefined;
  get(id: string): ArrayBuffer | undefined;
  content(userId: number): ImageContent | undefined;
  contentById(id: string): ImageContent | undefined;
  dump(): Generator<string>;
}
