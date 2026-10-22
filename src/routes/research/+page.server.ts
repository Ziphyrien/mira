import { isAdministrator } from "#lib/server/features/admin.js";
import { listResearchStudies } from "#lib/server/features/research.js";
export const load: import("./$types").PageServerLoad = async ({ cookies }) => {
  const authenticated = await isAdministrator(cookies);
  return { authenticated, studies: authenticated ? await listResearchStudies() : [] };
};
