import { handleCancelPost } from "#lib/server/features/conversation.js";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = handleCancelPost;
