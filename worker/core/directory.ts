import { createHost } from "@earendil-works/chord";
import type { Sql } from "./storage";
import { indexFacet } from "../plugins/admin/facet";
import { IndexCommands } from "../plugins/admin/api";
import { modelSettingsFacet } from "../plugins/models/directory-facet";
import { ModelSettings } from "../plugins/models/api";
import { ResearchIndex } from "../plugins/research/api";
import { researchIndexFacet } from "../plugins/research/facet";
export async function openDirectory(sql: Sql) {
  const host = createHost({ name: "mira.directory", self: null });
  try {
    await host.load([indexFacet(sql), modelSettingsFacet(sql), researchIndexFacet(sql)]);
    const [index, models, research] = await Promise.all([
      host.get(IndexCommands, {}),
      host.get(ModelSettings, {}),
      host.get(ResearchIndex, {}),
    ]);
    return { index, models, research };
  } catch (error) {
    await host.close();
    throw error;
  }
}
