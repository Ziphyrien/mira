import { error } from "@sveltejs/kit";
import { directory } from "#lib/server/space.js";
import { research, researchData, interviewCookie } from "#lib/server/features/research.js";
export const load: import("./$types").PageServerLoad = async ({ params, cookies }) => {
  if (!/^[A-Za-z0-9_-]{11}$/.test(params.code)) error(404, "没有找到这项研究。");
  const id = await directory().researchResolve(params.code);
  if (!id) error(404, "没有找到这项研究。");
  const stub = research(id),
    study = researchData(await stub.publicInfo());
  const token = cookies.get(interviewCookie(id)),
    result = token ? await stub.readSession(token) : null;
  return { study, interview: result?.ok ? result.data : null };
};
