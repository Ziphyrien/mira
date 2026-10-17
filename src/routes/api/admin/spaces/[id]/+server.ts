import { handleAdminSpacesInspect, handleAdminSpacesWipe } from "#lib/server/features/admin.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = handleAdminSpacesInspect;
export const DELETE: RequestHandler = handleAdminSpacesWipe;
