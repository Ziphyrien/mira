import { createContext } from "svelte";
import type { Profile, SpaceState } from "#lib/contracts/index.js";
export interface ProfilePort {
  readonly profile: Profile;
  apply(state: SpaceState): Promise<void>;
}
export const [getProfile, setProfile] = createContext<ProfilePort>();
