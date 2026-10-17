import { handleModelsAdminGet, handleModelsAdminPut } from "#lib/server/features/models.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = handleModelsAdminGet;
export const PUT: RequestHandler = handleModelsAdminPut;
