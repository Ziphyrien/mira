export { Images } from "./store";
import { local, method, opaque } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import type { ImageInfo } from "../../../src/lib/contracts";
import { localValue } from "../../core/contracts";
import type { ImagePort } from "./ports";
export const ImageStore = local("mira.images.store", {
  version: 1,
  input: Type.Object({}),
  members: { store: opaque<ImagePort>("mira.sqlite-images@1") },
});
export const ImageCommands = local("mira.images.commands", {
  version: 1,
  input: Type.Object({}),
  members: {
    upload: method(
      localValue<ArrayBuffer>("array-buffer@1"),
      localValue<{ ok: true; image: ImageInfo } | { ok: false; status: number; message: string }>(
        "mira.image-upload@1",
      ),
    ),
    read: method(Type.String(), localValue<ArrayBuffer | undefined>("optional-array-buffer@1")),
  },
});
