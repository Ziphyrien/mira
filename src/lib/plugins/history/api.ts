import { local, method, opaque } from "@earendil-works/chord";
import { Type } from "typebox";
import type { HistoryPage, Row } from "#lib/contracts/index.js";
import { localValue, type ReadonlyView } from "#lib/app/feature.js";
import type { HistoryNavigationPort, HistorySnapshot, PrependResult } from "./ports.js";
export const History = local("mira.web.history", {
  version: 1,
  input: Type.Object({}),
  members: {
    navigation: opaque<HistoryNavigationPort>("mira.history-navigation@1"),
    view: opaque<ReadonlyView<HistorySnapshot>>("mira.history-view@1"),
    prefetch: method(Type.Null(), localValue<HistoryPage | null>("mira.history-page@1")),
    prepend: method(Type.Null(), localValue<PrependResult>("mira.prepend-result@1")),
    loadUntil: method(Type.Integer(), Type.Boolean()),
    reset: method(Type.Null(), Type.Void()),
    retry: method(Type.Null(), Type.Void()),
    replace: method(
      Type.Object({
        rows: localValue<Row[]>("mira.rows@1"),
        nextBefore: Type.Union([Type.Integer(), Type.Null()]),
      }),
      Type.Void(),
    ),
    apply: method(localValue<Row[]>("mira.rows@1"), Type.Void()),
    append: method(localValue<Row>("mira.row@1"), Type.Void()),
  },
});
