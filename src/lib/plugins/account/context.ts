import { createContext } from "svelte";
import type { Ref } from "@earendil-works/chord";
import type { Account } from "#lib/plugins/account/api.js";
export type AccountPort = Pick<
  Ref<typeof Account>,
  "view" | "apply" | "reset" | "flushDraft" | "clearDraft"
>;
export const [getAccount, setAccount] = createContext<AccountPort>();
