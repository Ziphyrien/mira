import { local, method, opaque } from "@earendil-works/chord";
import { Type } from "typebox";
import type { DraftBuffer } from "./ports.js";

export const Drafts = local("mira.web.drafts", {
  version: 1,
  input: Type.Object({}),
  members: {
    buffer: opaque<DraftBuffer>("mira.draft-buffer@1"),
    flush: method(Type.Null(), Type.Void()),
    clear: method(Type.Null(), Type.Void()),
  },
});
