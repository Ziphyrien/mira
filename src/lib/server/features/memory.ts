import { error, type RequestHandler } from "@sveltejs/kit";
import { MAX_MEMORY_BACKUP_BYTES } from "#lib/contracts/memory-backup.js";
import { readJson } from "#lib/server/body.js";
import { space } from "#lib/server/space.js";

export const handleMemoryImportPost: RequestHandler = async ({ locals, request }) => {
  if (!locals.uid) error(401, "未找到你的空间");
  const result = await space(locals.uid).memoryImport(
    await readJson(request, MAX_MEMORY_BACKUP_BYTES),
  );
  if (!result.ok) error(result.status, result.message);
  return Response.json(result);
};

export const handleMemoryExportGet: RequestHandler = async ({ locals }) => {
  if (!locals.uid) error(401, "未找到你的空间");
  return new Response(await space(locals.uid).memoryExport(), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="mira-memory.json"',
      "Cache-Control": "private, no-store",
    },
  });
};

export const handleMemoryLinesGet: RequestHandler = async ({ locals }) => {
  if (!locals.uid) error(401, "未找到你的空间");
  return Response.json(await space(locals.uid).memoryLines());
};

export const handleMemoryTreeGet: RequestHandler = async ({ url, locals }) => {
  if (!locals.uid) error(401, "未找到你的空间");
  const id = url.searchParams.get("id");
  const n = url.searchParams.get("n");
  if ((id === null) !== (n === null)) error(400, "需要同时指定消息编号和范围");
  if (
    id !== null &&
    n !== null &&
    (!/^\d+$/.test(id) ||
      !/^\d+$/.test(n) ||
      !Number.isSafeInteger(Number(id)) ||
      !Number.isSafeInteger(Number(n)) ||
      Number(n) < 1)
  )
    error(404, "这个摘要节点不存在");
  const tree = await space(locals.uid).memoryTree(
    id === null ? undefined : Number(id),
    n === null ? undefined : Number(n),
  );
  if (!tree) error(404, "这个摘要节点不存在");
  return Response.json(tree, { headers: { "Cache-Control": "private, no-store" } });
};
