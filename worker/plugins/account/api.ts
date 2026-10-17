import { local, method } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import type { SpaceState, SpaceDetail } from "../../../src/lib/contracts";
import { localValue } from "../../core/contracts";
export { AccountIdentity } from "./identity";

export interface AccountIdentityPort {
  uid(): string | undefined;
  created(): number;
}
export const AccountCommands = local("mira.account.commands", {
  version: 1,
  input: Type.Object({}),
  members: {
    state: method(Type.String(), localValue<SpaceState>("mira.space-state@1")),
    configure: method(
      Type.Object({ uid: Type.String(), input: Type.Unknown() }),
      localValue<SpaceState>("mira.space-state@1"),
    ),
    inspect: method(Type.Null(), localValue<SpaceDetail>("mira.space-detail@1")),
  },
});
