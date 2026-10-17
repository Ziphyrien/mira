import { local, method, opaque } from "@earendil-works/chord";
import { Type } from "typebox";
import type { ReadonlyView } from "#lib/app/feature.js";
import type { AdminSnapshot } from "#lib/plugins/admin/controller.js";
export const Admin = local("mira.web.admin", {
  version: 1,
  input: Type.Object({}),
  members: {
    view: opaque<ReadonlyView<AdminSnapshot>>("mira.admin-view@1"),
    initialize: method(Type.Null(), Type.Void()),
    login: method(Type.String(), Type.Void()),
    logout: method(Type.Null(), Type.Void()),
    list: method(Type.Union([Type.String(), Type.Null()]), Type.Void()),
    open: method(Type.Union([Type.String(), Type.Null()]), Type.Void()),
    delete: method(Type.String(), Type.Void()),
  },
});
