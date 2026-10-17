import { error, type RequestHandler } from "@sveltejs/kit";
import { readJsonOrNull } from "#lib/server/body.js";
import { KeyInput, ProfileInput, type SpaceState } from "#lib/contracts/index.js";
import { KEY_COOKIE, displayKey, ipDay, newKey, setKey, uidOf } from "#lib/server/identity.js";
import { directory, space } from "#lib/server/space.js";
import { normalizeKey } from "#lib/shared/identity.js";

/** Read a request's space for native server loads and the account endpoint. */
export async function getSpaceState(uid: string | null): Promise<SpaceState> {
  if (!uid)
    return {
      profile: null,
      model: null,
      speech: null,
      tts: false,
      messages: [],
      nextBefore: null,
      busy: false,
      generation: null,
    };
  return space(uid).state(uid);
}

export const handleMeGet: RequestHandler = async ({ locals }) =>
  Response.json(await getSpaceState(locals.uid));

export const handleMeDelete: RequestHandler = async ({ locals, cookies }) => {
  if (locals.uid) await space(locals.uid).wipe();
  cookies.delete(KEY_COOKIE, { path: "/" });
  return Response.json({ ok: true });
};

export const handleKeyGet: RequestHandler = async ({ locals }) => {
  if (!locals.key) error(404, "这台设备还没有账户");
  return Response.json({ key: displayKey(locals.key) });
};

export const handleKeyPost: RequestHandler = async ({ request, cookies, getClientAddress }) => {
  const input = KeyInput.safeParse(await readJsonOrNull(request, 1024));
  const key = input.success ? normalizeKey(input.data.key) : null;
  if (!key) error(400, "密钥格式不正确");
  const dir = directory();
  if (!(await dir.mint(await ipDay(getClientAddress())))) error(429, "尝试太多次了，明天再试");
  const uid = await uidOf(key);
  if (!(await dir.has(uid))) error(404, "没有找到对应的账户，请检查密钥是否正确");
  setKey(cookies, key);
  return Response.json({ ok: true });
};

export const handleOnboardPost: RequestHandler = async ({
  request,
  locals,
  cookies,
  getClientAddress,
}) => {
  const profile = ProfileInput.safeParse(await readJsonOrNull(request, 4096));
  if (!profile.success) error(400, "资料格式不正确");
  let uid = locals.uid;
  if (!uid) {
    if (!(await directory().mint(await ipDay(getClientAddress()))))
      error(429, "今天创建的太多了，明天再试");
    const key = newKey();
    uid = await uidOf(key);
    setKey(cookies, key);
  }
  return Response.json(await space(uid).onboard(uid, profile.data));
};

export const handleProfilePut: RequestHandler = async ({ request, locals }) => {
  if (!locals.uid) error(401, "未找到你的空间");
  const profile = ProfileInput.safeParse(await readJsonOrNull(request, 4096));
  if (!profile.success) error(400, "资料格式不正确");
  return Response.json(await space(locals.uid).onboard(locals.uid, profile.data));
};
