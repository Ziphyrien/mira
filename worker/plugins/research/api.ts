import { local, method } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { localValue } from "../../core/contracts";
import type { StudyListing } from "../../../src/lib/contracts/research";
export const ResearchIndex = local("mira.research.index", {
  version: 1,
  input: Type.Object({}),
  members: {
    list: method(Type.Null(), localValue<StudyListing[]>("mira.research-list@1")),
    add: method(localValue<StudyListing>("mira.research-entry@1"), Type.Void()),
    remove: method(Type.String(), Type.Void()),
    share: method(Type.String(), Type.String()),
    resolve: method(Type.String(), Type.Union([Type.String(), Type.Null()])),
  },
});
