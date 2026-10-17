import { error, type RequestHandler } from "@sveltejs/kit";
import { space } from "#lib/server/space.js";

export const handleHistoryGet: RequestHandler = async ({ url, locals }) => {
  if (!locals.uid) error(401, "未找到你的空间");
  const cursor = url.searchParams.get("before");
  const size = url.searchParams.get("limit");
  const before = cursor === null ? undefined : Number(cursor);
  const limit = size === null ? 80 : Number(size);
  if (cursor !== null && (!/^\d+$/.test(cursor) || !Number.isSafeInteger(before)))
    error(400, "无效的历史游标");
  if (
    size !== null &&
    (!/^\d+$/.test(size) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
  )
    error(400, "无效的分页大小");
  return Response.json(await space(locals.uid).history(before, limit));
};
