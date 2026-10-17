import { handleKeyGet, handleKeyPost } from "#lib/server/features/account.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = handleKeyGet;
export const POST: RequestHandler = handleKeyPost;
