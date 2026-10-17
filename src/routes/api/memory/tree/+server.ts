import { handleMemoryTreeGet } from "#lib/server/features/memory.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = handleMemoryTreeGet;
