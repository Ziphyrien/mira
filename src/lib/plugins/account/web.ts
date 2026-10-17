import { defineFacet, type Facet } from "@earendil-works/chord";
import type { Profile } from "#lib/contracts/index.js";
import { settingsSectionRegistry, toolbarRegistry, overlayRegistry } from "#lib/app/registries.js";
import SettingsControl from "#lib/plugins/account/SettingsControl.svelte";
import SettingsDialog from "#lib/app/SettingsDialog.svelte";

import { Models } from "#lib/plugins/models/api.js";
import { Speech } from "#lib/plugins/speech/api.js";
import { AccountState } from "#lib/plugins/account/state.svelte.js";
import AccountSettings from "#lib/plugins/account/AccountSettings.svelte";
import { Account } from "#lib/plugins/account/api.js";
import { Drafts } from "#lib/plugins/drafts/api.js";
export function accountWeb(profile: Profile, reset: () => void): Facet {
  return {
    name: "mira.web.account",
    ...defineFacet(
      (api) =>
        api.serve(
          Account,
          (_input, _principal, self) => {
            const drafts = self.get(Drafts, {});
            const models = self.get(Models, {}),
              speech = self.get(Speech, {});
            const res = {
              account: self.resource("account", {
                version: 1,
                open: () => new AccountState(profile),
              }),
            };
            self.register(settingsSectionRegistry, {
              account: { order: 30, component: AccountSettings },
            });
            self.register(toolbarRegistry, { settings: { order: 50, component: SettingsControl } });
            self.register(overlayRegistry, { settings: { order: 20, component: SettingsDialog } });
            return {
              view: {
                get profile() {
                  return res.account.value.profile!;
                },
              },
              apply: async (state, ctx) => {
                if (!state.profile) {
                  reset();
                  return;
                }
                res.account.value.profile = state.profile;
                await models.setModel(state.model, ctx);
                await speech.preferences({ preferences: state.speech, enabled: state.tts }, ctx);
              },
              reset: () => reset(),
              flushDraft: (_input, ctx) => drafts.flush(null, ctx),
              clearDraft: (_input, ctx) => drafts.clear(null, ctx),
            };
          },
          { lifetime: "host" },
        ),
      { uses: [Models, Speech, Drafts] },
    ),
  };
}
