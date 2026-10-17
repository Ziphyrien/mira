import { error, type RequestHandler } from "@sveltejs/kit";
import { ChatInput, StopInput } from "#lib/contracts/index.js";
import { readJson } from "#lib/server/body.js";
import { space } from "#lib/server/space.js";

export const handleChatPost: RequestHandler = async ({ request, locals }) => {
  if (!locals.uid) error(401, "未找到你的空间");
  const input = ChatInput.safeParse(await readJson(request, 32768));
  if (!input.success) error(400, "消息格式不正确");
  const body = await space(locals.uid).chat(locals.uid, input.data);
  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
};

export const handleCancelPost: RequestHandler = async ({ request, locals }) => {
  if (!locals.uid) error(401, "未找到你的空间");
  const input = StopInput.safeParse(await readJson(request, 2048));
  if (!input.success) error(400, "停止请求格式不正确");
  return Response.json(await space(locals.uid).stop(input.data.requestId), {
    headers: { "Cache-Control": "no-store" },
  });
};
