import { handleMeGet, handleMeDelete } from "#lib/server/features/account.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = handleMeGet;
export const DELETE: RequestHandler = handleMeDelete;
