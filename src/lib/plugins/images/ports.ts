import type { Ref } from "@earendil-works/chord";
import type { Images } from "./api.js";

export type ImageDraftSnapshot = {
  readonly blob: Blob | null;
  readonly url: string | null;
  readonly preparing: boolean;
  readonly uploading: boolean;
  readonly error: string | null;
  readonly supportsImages: boolean;
};

export type ImagesPort = Pick<Ref<typeof Images>, "view" | "prepare" | "clear">;
