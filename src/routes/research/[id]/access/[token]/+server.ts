import { error, redirect } from "@sveltejs/kit";
import { research, managementCookie } from "#lib/server/features/research.js";
export const GET: import("./$types").RequestHandler = async (event) => {
  const { id, token } = event.params;
  if (!/^[a-f0-9]{64}$/.test(token) || !(await research(id).canManage(token)))
    error(404, "管理链接无效或已失效。");
  event.cookies.set(managementCookie(id), token, {
    path: "/",
    httpOnly: true,
    secure: event.url.protocol === "https:",
    sameSite: "strict",
    maxAge: 365 * 86400,
  });
  redirect(303, "/research/" + id);
};
