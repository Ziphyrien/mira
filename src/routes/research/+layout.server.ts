import { isAdministrator } from "#lib/server/features/admin.js";
import { listResearchStudies, researchDraftNamespace } from "#lib/server/features/research.js";
export const load: import("./$types").LayoutServerLoad = async (event) => {
  const authenticated = await isAdministrator(event.cookies);
  // Seed the first list render only. Child navigation keeps this layout and its query cache.
  const enteringList = event.untrack(() => event.route.id === "/research");
  return {
    authenticated,
    draftNamespace: authenticated ? await researchDraftNamespace(event) : null,
    studies: authenticated && enteringList ? await listResearchStudies() : undefined,
  };
};
