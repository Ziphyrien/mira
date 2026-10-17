import { defineFacet, type Facet } from "@earendil-works/chord";
import type { SpeechPreferences } from "#lib/contracts/index.js";
import { toolbarRegistry, settingsSectionRegistry, composerActionRegistry } from "#lib/app/registries.js";
import { Speech } from "#lib/plugins/speech/api.js";
import { SpeechPlayer } from "#lib/plugins/speech/player.svelte.js";
import { SpeechState } from "#lib/plugins/speech/state.svelte.js";
import SpeechInput from "./SpeechInput.svelte";
import SpeechControl from "#lib/plugins/speech/SpeechControl.svelte";
import SpeechSettings from "#lib/plugins/speech/SpeechSettings.svelte";

export function speechWeb(preferences: SpeechPreferences, enabled: boolean): Facet {
  return {
    name: "mira.web.speech",
    ...defineFacet((api) =>
      api.serve(
        Speech,
        (_input, _principal, self) => {
          const res = {
            player: self.resource("player", {
              version: 1,
              open: () => new SpeechPlayer(),
              close: (player) => player.dispose(),
            }),
            state: self.resource("state", {
              version: 1,
              open: () => new SpeechState(preferences, enabled),
              close: (state) => state.dispose(),
            }),
          };
          self.register(composerActionRegistry, { speech: { order: 20, component: SpeechInput } });
          self.register(toolbarRegistry, { speech: { order: 20, component: SpeechControl } });
          self.register(settingsSectionRegistry, {
            speech: { order: 20, component: SpeechSettings },
          });
          return {
            view: {
              get active() {
                return res.player.value.active;
              },
              get error() {
                return res.state.value.error || res.player.value.error;
              },
              get enabled() {
                return res.state.value.enabled;
              },
              get dictating() {
                return res.state.value.dictating;
              },
              get preferences() {
                return res.state.value.preferences!;
              },
              report: (error: string) => res.state.value.report(error),
              run: (work: Promise<unknown>) => res.state.value.run(work),
            },
            play: async (text, ctx) => {
              if (res.state.value.enabled && !res.state.value.dictating) {
                res.state.value.report("");
                await res.player.value.play(text, ctx.signal);
              }
            },
            stop: () => res.player.value.stop(),
            unlock: (_input, ctx) =>
              res.player.value.unlock(ctx.signal).catch(() => {
                if (!ctx.signal.aborted) res.state.value.report("点击播放以启用声音。");
              }),
            dictating: (value) => {
              res.state.value.dictating = value;
              if (value) {
                res.player.value.stop();
                res.state.value.report("");
              }
            },
            preferences: ({ preferences: value, enabled: available }) => {
              res.state.value.preferences = value;
              if (available !== undefined) res.state.value.enabled = available;
              if (!value.autoPlay) res.player.value.stop();
            },
          };
        },
        { lifetime: "host" },
      ),
    ),
  };
}
