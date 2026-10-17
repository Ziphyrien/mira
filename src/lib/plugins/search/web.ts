import { defineFacet, type Facet } from "@earendil-works/chord";
import { toolbarRegistry, overlayRegistry } from "#lib/app/registries.js";
import { History } from "#lib/plugins/history/api.js";
import { Search } from "#lib/plugins/search/api.js";
import { SearchState } from "#lib/plugins/search/state.svelte.js";
import SearchControl from "#lib/plugins/search/SearchControl.svelte";
import SearchDialog from "#lib/plugins/search/SearchDialog.svelte";
export const searchWeb: Facet = {
  name: "mira.web.search",
  ...defineFacet(
    (api) =>
      api.serve(
        Search,
        (_input, _principal, self) => {
          const history = self.get(History, {});
          const res = {
            search: self.resource("search", {
              version: 1,
              deps: [history],
              open: () => new SearchState(history.navigation!),
              close: (owner) => owner.dispose(),
            }),
          };
          self.register(toolbarRegistry, { search: { order: 40, component: SearchControl } });
          self.register(overlayRegistry, { search: { order: 10, component: SearchDialog } });
          return { view: self.expose(res.search) };
        },
        { lifetime: "host" },
      ),
    { uses: [History] },
  ),
};
