import { handleSpeechSynthesizePost } from "#lib/server/features/speech.js";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = handleSpeechSynthesizePost;
