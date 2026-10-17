import { createHost } from "@earendil-works/chord";
import type { Sql } from "./storage";
import { indexFacet } from "../plugins/admin/facet";
import { IndexCommands } from "../plugins/admin/api";
import { modelSettingsFacet } from "../plugins/models/directory-facet";
import { ModelSettings } from "../plugins/models/api";
export async function openDirectory(sql: Sql) {
  const host = createHost({ name: "mira.directory", self: null });
  try {
    await host.load([indexFacet(sql), modelSettingsFacet(sql)]);
    const [index, models] = await Promise.all([
      host.get(IndexCommands, {}),
      host.get(ModelSettings, {}),
    ]);
    return { index, models };
  } catch (error) {
    await host.close();
    throw error;
  }
}
