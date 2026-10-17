import { handleSpeechSettingsPut } from "#lib/server/features/speech.js";
import type { RequestHandler } from "./$types";

export const PUT: RequestHandler = handleSpeechSettingsPut;
