import { defineFacet, type Facet } from "@earendil-works/chord";
import { AdminController, type AdminControllerOptions } from "#lib/plugins/admin/controller.js";

import { Admin } from "#lib/plugins/admin/api.js";
export function adminWeb(options?: AdminControllerOptions): Facet {
  return {
    name: "mira.web.admin",
    ...defineFacet((api) =>
      api.serve(
        Admin,
        (_input, _principal, self) => {
          const res = {
            owner: self.resource("owner", {
              version: 1,
              open: () => new AdminController(options),
              close: (owner) => owner.dispose(),
            }),
          };
          return {
            view: {
              get snapshot() {
                return res.owner.value.snapshot;
              },
              subscribe: (cb) => res.owner.value.subscribe(cb),
            },
            initialize: (_input, ctx) => res.owner.value.initialize(ctx.signal),
            login: (token, ctx) => res.owner.value.login(token, ctx.signal),
            logout: (_input, ctx) => res.owner.value.logout(ctx.signal),
            list: (query, ctx) => res.owner.value.list(query, ctx.signal),
            open: (id, ctx) => res.owner.value.open(id, ctx.signal),
            delete: (id, ctx) => res.owner.value.delete(id, ctx.signal),
          };
        },
        { lifetime: "host" },
      ),
    ),
  };
}
