import { createHost } from "@earendil-works/chord";
import { adminSectionRegistry, type ViewContribution } from "#lib/app/registries.js";
import { modelAdminFacet } from "#lib/plugins/models/admin-web.js";
import { Admin } from "#lib/plugins/admin/api.js";
import { adminWeb } from "#lib/plugins/admin/web.js";
import type { AdminControllerOptions } from "#lib/plugins/admin/controller.js";

type AdminSectionEntry = {
  key: string;
  order: number;
  component: ViewContribution["component"];
};

export async function createAdminAppHost(options?: AdminControllerOptions) {
  const host = createHost({ name: "mira.web.admin", self: null });
  try {
    await host.load([adminWeb(options), modelAdminFacet]);
    const admin = await host.get(Admin, {});
    const getSections = (): AdminSectionEntry[] => {
      const table = host.registry(adminSectionRegistry).table();
      return [...table.entries()]
        .map(([key, value]) => ({ key, ...value }))
        .sort((a, b) => a.order - b.order);
    };
    return {
      admin,
      getSections,
      dispose: async () => {
        await host.close();
      },
    };
  } catch (error) {
    await host.close();
    throw error;
  }
}

export type AdminAppHost = Awaited<ReturnType<typeof createAdminAppHost>>;
