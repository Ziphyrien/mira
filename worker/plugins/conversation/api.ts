import { local, method, opaque } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { localValue } from "../../core/contracts";
import type { ConversationPersistencePort } from "./ports";
export const ConversationStore = local("mira.conversation.persistence", {
  version: 1,
  input: Type.Object({}),
  members: { store: opaque<ConversationPersistencePort>("mira.conversation-persistence@1") },
});
export const ConversationCommands = local("mira.conversation.commands", {
  version: 1,
  input: Type.Object({}),
  members: {
    chat: method(
      Type.Object({ uid: Type.String(), input: Type.Unknown() }),
      localValue<ReadableStream<Uint8Array>>("mira.ndjson-readable@1"),
    ),
    stop: method(Type.String(), Type.Void()),
    busy: method(Type.Null(), Type.Boolean()),
    prepareImport: method(Type.Null(), Type.Boolean()),
  },
});
