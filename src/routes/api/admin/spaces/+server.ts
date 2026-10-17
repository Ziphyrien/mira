import { handleAdminSpacesList } from "#lib/server/features/admin.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = handleAdminSpacesList;
