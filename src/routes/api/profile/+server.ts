import { handleProfilePut } from "#lib/server/features/account.js";
import type { RequestHandler } from "./$types";

export const PUT: RequestHandler = handleProfilePut;
