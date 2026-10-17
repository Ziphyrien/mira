import { handleImagesUploadPost } from "#lib/server/features/images.js";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = handleImagesUploadPost;
