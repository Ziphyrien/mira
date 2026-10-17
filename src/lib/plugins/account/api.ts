import { local, method, opaque } from "@earendil-works/chord";
import { Type } from "typebox";
import type { Profile, SpaceState } from "#lib/contracts/index.js";
import { localValue } from "#lib/app/feature.js";
export interface AccountView {
  readonly profile: Profile;
}
export const Account = local("mira.web.account", {
  version: 1,
  input: Type.Object({}),
  members: {
    view: opaque<AccountView>("mira.account-view@1"),
    apply: method(localValue<SpaceState>("mira.space-state@1"), Type.Void()),
    reset: method(Type.Null(), Type.Void()),
    flushDraft: method(Type.Null(), Type.Void()),
    clearDraft: method(Type.Null(), Type.Void()),
  },
});
