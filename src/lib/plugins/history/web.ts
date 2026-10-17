import { defineFacet, type Facet } from "@earendil-works/chord";
import type { HistoryPage } from "#lib/contracts/index.js";
import { viewOf } from "#lib/app/feature.js";
import { HistoryNavigation } from "#lib/plugins/history/navigation.js";
import { HistoryController } from "#lib/plugins/history/history.js";
import type { HistorySnapshot } from "./ports.js";
import { History } from "#lib/plugins/history/api.js";
export function historyWeb(initial: HistoryPage): Facet {
  return {
    name: "mira.web.history",
    ...defineFacet((api) =>
      api.serve(
        History,
        (_input, _principal, self) => {
          const navigation = self.resource("navigation", {
            version: 1,
            open: () => new HistoryNavigation(),
            close: (owner) => owner.dispose(),
          });
          const history = self.resource("history", {
            version: 1,
            open: () =>
              new HistoryController({
                initialRows: initial.messages,
                initialNextBefore: initial.nextBefore,
              }),
            close: (owner) => owner.dispose(),
          });
          return {
            navigation: self.expose(navigation),
            view: viewOf<HistorySnapshot>(() => history.value),
            prefetch: (_input, ctx) => history.value.prefetchEarlier(ctx.signal),
            prepend: () => history.value.prependEarlier(),
            loadUntil: (id, ctx) => history.value.loadUntil(id, ctx.signal),
            reset: () => history.value.reset(),
            retry: (_input, ctx) => history.value.retry(ctx.signal),
            replace: ({ rows, nextBefore }) => history.value.replace(rows, nextBefore),
            apply: (rows) => history.value.applyMessages(rows),
            append: (row) => {
              const old = history.value.snapshot;
              history.value.replace([...old.rows, row], old.nextBefore);
            },
          };
        },
        { lifetime: "host" },
      ),
    ),
  };
}
