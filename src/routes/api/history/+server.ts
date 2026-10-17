import { handleHistoryGet } from "#lib/server/features/history.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = handleHistoryGet;
