import { handleOnboardPost } from "#lib/server/features/account.js";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = handleOnboardPost;
