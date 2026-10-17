import type { Profile } from "#lib/contracts/index.js";
export class AccountState {
  profile = $state.raw<Profile>();
  constructor(profile: Profile) {
    this.profile = profile;
  }
}
