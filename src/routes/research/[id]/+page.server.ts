import {
  requireStudyManagement,
  research,
  researchData,
  researchDraftNamespace,
} from "#lib/server/features/research.js";
import { isAdministrator } from "#lib/server/features/admin.js";
export const load: import("./$types").PageServerLoad = async (event) => {
  await requireStudyManagement(event);
  return {
    inspection: researchData(await research(event.params.id).inspect()),
    administrator: await isAdministrator(event.cookies),
    draftNamespace: await researchDraftNamespace(event),
  };
};
