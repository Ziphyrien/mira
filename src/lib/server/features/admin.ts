import { error, type Cookies, type RequestHandler } from "@sveltejs/kit";
import { readJsonOrNull } from "#lib/server/body.js";
import { LoginInput } from "#lib/contracts/index.js";
import { ADMIN_COOKIE, adminValue, equal, isAdmin } from "#lib/server/identity.js";
import { adminToken, directory, space } from "#lib/server/space.js";

const ID = /^[0-9a-f]{32}$/;

/** Only the authentication result may be returned from an admin server load. */
export async function isAdministrator(cookies: Cookies): Promise<boolean> {
  return isAdmin(cookies, adminToken());
}

export const handleAdminSessionGet: RequestHandler = async ({ cookies }) =>
  Response.json({ admin: await isAdministrator(cookies) });

export const handleAdminSessionPost: RequestHandler = async ({ request, cookies }) => {
  const input = LoginInput.safeParse(await readJsonOrNull(request, 2048));
  const token = adminToken();
  if (
    !token ||
    !input.success ||
    !equal(await adminValue(input.data.token), await adminValue(token))
  ) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    error(401, "令牌不正确");
  }
  cookies.set(ADMIN_COOKIE, await adminValue(token), {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 12,
  });
  return Response.json({ admin: true });
};

export const handleAdminSessionDelete: RequestHandler = async ({ cookies }) => {
  cookies.delete(ADMIN_COOKIE, { path: "/" });
  return Response.json({ admin: false });
};

export const handleAdminSpacesList: RequestHandler = async ({ url, cookies }) => {
  if (!(await isAdministrator(cookies))) error(401, "需要登录");
  const query = (url.searchParams.get("q") ?? "").slice(0, 64);
  const cursor = url.searchParams.get("offset");
  const offset = cursor === null ? 0 : Number(cursor);
  if (cursor !== null && (!/^\d+$/.test(cursor) || !Number.isSafeInteger(offset)))
    error(400, "无效的分页偏移");
  return Response.json(await directory().list(query, offset));
};

export const handleAdminSpacesInspect: RequestHandler = async ({ params, cookies }) => {
  if (!(await isAdministrator(cookies))) error(401, "需要登录");
  const id = params.id;
  if (!id || !ID.test(id)) error(400, "bad id");
  return Response.json(await space(id).inspect());
};

export const handleAdminSpacesWipe: RequestHandler = async ({ params, cookies }) => {
  if (!(await isAdministrator(cookies))) error(401, "需要登录");
  const id = params.id;
  if (!id || !ID.test(id)) error(400, "bad id");
  await space(id).wipe();
  return Response.json({ ok: true });
};
