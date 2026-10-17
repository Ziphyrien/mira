import { error, type RequestHandler } from "@sveltejs/kit";
import { readJson } from "#lib/server/body.js";
import { AiConfigInput } from "#lib/contracts/index.js";
import { isAdministrator } from "#lib/server/features/admin.js";
import { directory } from "#lib/server/space.js";

export const handleModelsAdminGet: RequestHandler = async ({ cookies }) => {
  if (!(await isAdministrator(cookies))) error(401, "需要登录");
  return Response.json(await directory().aiAdmin(), { headers: { "Cache-Control": "no-store" } });
};

export const handleModelsAdminPut: RequestHandler = async ({ cookies, request }) => {
  if (!(await isAdministrator(cookies))) error(401, "需要登录");
  const input = AiConfigInput.safeParse(await readJson(request, 16_384));
  if (!input.success) error(400, "模型设置格式不正确");
  const result = await directory().updateAi(input.data);
  if (!result.ok) error(400, result.message);
  return Response.json(result.state, { headers: { "Cache-Control": "no-store" } });
};
