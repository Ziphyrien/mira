import { handleImagesGet } from "#lib/server/features/images.js";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = handleImagesGet;
