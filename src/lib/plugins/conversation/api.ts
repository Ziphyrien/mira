import { local, method, opaque } from "@earendil-works/chord";
import { Type } from "typebox";
import type { Row } from "#lib/contracts/index.js";
import { localValue, type ReadonlyView } from "#lib/app/feature.js";
import type { ComposerPort, ConversationSnapshot } from "./ports.js";
export const Conversation = local("mira.web.conversation", {
  version: 1,
  input: Type.Object({}),
  members: {
    composer: opaque<ComposerPort>("mira.composer@1"),
    view: opaque<ReadonlyView<ConversationSnapshot>>("mira.conversation-view@1"),
    send: method(Type.String(), Type.Void()),
    regenerate: method(localValue<Row>("mira.row@1"), Type.Void()),
    stop: method(Type.Null(), Type.Void()),
    retry: method(Type.Null(), Type.Void()),
    reload: method(Type.Null(), Type.Void()),
    restore: method(Type.Null(), Type.Void()),
  },
});
