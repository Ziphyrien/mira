import { local, method, opaque } from "@earendil-works/chord";
import { Type } from "typebox";
import type { AiModelInfo, ImageInfo } from "#lib/contracts/index.js";
import { localValue, type ReadonlyView } from "#lib/app/feature.js";
import type { ImageDraftSnapshot } from "#lib/plugins/images/ports.js";
export const Images = local("mira.web.images", {
  version: 1,
  input: Type.Object({}),
  members: {
    view: opaque<ReadonlyView<ImageDraftSnapshot>>("mira.image-draft-view@1"),
    pick: method(localValue<Blob>("blob@1"), Type.Boolean()),
    prepare: method(localValue<File>("file@1"), localValue<Blob | null>("optional-blob@1")),
    clear: method(Type.Null(), Type.Void()),
    clearError: method(Type.Null(), Type.Void()),
    upload: method(Type.Null(), localValue<ImageInfo | null>("mira.image-info@1")),
    setModel: method(localValue<AiModelInfo | null>("mira.model-info@1"), Type.Void()),
  },
});
