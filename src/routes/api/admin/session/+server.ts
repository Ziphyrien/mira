import {
  handleAdminSessionGet,
  handleAdminSessionPost,
  handleAdminSessionDelete,
} from "#lib/server/features/admin.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = handleAdminSessionGet;
export const POST: RequestHandler = handleAdminSessionPost;
export const DELETE: RequestHandler = handleAdminSessionDelete;
