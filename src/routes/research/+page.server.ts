import { isAdministrator } from "#lib/server/features/admin.js";
import { listResearchStudies, researchDraftNamespace } from "#lib/server/features/research.js";
export const load: import("./$types").PageServerLoad = async (event) => {
  const authenticated = await isAdministrator(event.cookies);
  return {
    authenticated,
    draftNamespace: authenticated ? await researchDraftNamespace(event) : null,
    studies: authenticated ? await listResearchStudies() : [],
  };
};
