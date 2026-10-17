import { Buffer } from "node:buffer";
import { error, type RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { readBody, readJson } from "#lib/server/body.js";
import { SpeechPreferences } from "#lib/contracts/index.js";
import { ai, space } from "#lib/server/space.js";

const SpeechCancellation = z.object({ requestId: z.uuid() }).strict();
const SpeechInput = SpeechCancellation.extend({ text: z.string().trim().min(1).max(1000) });

export const handleSpeechSynthesizePost: RequestHandler = async ({ request, locals }) => {
  if (!locals.uid) error(401, "请先进入你的账户");
  const input = SpeechInput.safeParse(await readJson(request, 8192));
  if (!input.success) error(400, "播报内容格式不正确");
  const result = await space(locals.uid).synthesizeSpeech(input.data.requestId, input.data.text);
  if (!result.ok) error(result.status, result.message);
  return new Response(result.audio, {
    headers: {
      "Content-Type": "audio/pcm;rate=24000;channels=1",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
};

export const handleSpeechCancelPost: RequestHandler = async ({ request, locals }) => {
  if (!locals.uid) error(401, "请先进入你的账户");
  const input = SpeechCancellation.safeParse(await readJson(request, 1024));
  if (!input.success) error(400, "语音请求标识不正确");
  await space(locals.uid).cancelSpeech(input.data.requestId);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
};

export const handleSpeechSettingsPut: RequestHandler = async ({ request, locals }) => {
  if (!locals.uid) error(401, "请先进入你的账户");
  const input = SpeechPreferences.safeParse(await readJson(request, 4096));
  if (!input.success) error(400, "语音设置格式不正确");
  return Response.json(await space(locals.uid).updateSpeech(input.data), {
    headers: { "Cache-Control": "no-store" },
  });
};

export const handleSpeechTranscribePost: RequestHandler = async ({ request, locals }) => {
  if (!locals.uid || !(await space(locals.uid).speechPreferences())) error(401, "请先进入你的账户");
  if (!/^audio\/(webm|mp4|ogg|wav)(;|$)/i.test(request.headers.get("Content-Type") ?? ""))
    error(415, "不支持这种录音格式");
  const audio = await readBody(request, 2 * 1024 * 1024);
  if (!audio.byteLength) error(400, "录音为空");
  try {
    const result = await ai().run(
      "@cf/openai/whisper-large-v3-turbo",
      { audio: Buffer.from(audio).toString("base64"), task: "transcribe" },
      { signal: request.signal },
    );
    return Response.json(
      { text: result.text.trim() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    error(502, "暂时无法识别语音，请稍后再试。");
  }
};
