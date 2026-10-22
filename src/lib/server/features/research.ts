import { env } from "cloudflare:workers";
import { error, type RequestHandler, type RequestEvent } from "@sveltejs/kit";
import { isAdministrator } from "./admin";
import { directory, adminToken } from "../space";
import { readJson } from "../body";
import { RESEARCH_PROTOCOL } from "#lib/contracts/research-protocol.js";
import { ResearchBrief, type ResearchResult, type StudySummary } from "#lib/contracts/research.js";

export function research(id: string | undefined) {
  if (!id || !/^[0-9a-f]{32}$/.test(id)) error(404, "没有找到这项研究。");
  return env.RESEARCH.getByName(id);
}
export function researchData<T>(result: ResearchResult<T>): T {
  if (!result.ok) error(result.status, result.message);
  return result.data;
}
export function interviewCookie(id: string) {
  return "mira_interview_" + id;
}
async function requireAdmin(event: RequestEvent) {
  if (!(await isAdministrator(event.cookies))) error(401, "请先在管理后台登录。");
}
function session(event: RequestEvent) {
  const token = event.cookies.get(interviewCookie(event.params.id!));
  if (!token || !/^[0-9a-f]{64}$/.test(token)) error(401, "请先阅读参与说明并开始访谈。");
  return token;
}
export async function listResearchStudies(): Promise<StudySummary[]> {
  const entries = await directory().researchList();
  const summaries: StudySummary[] = [];
  for (let i = 0; i < entries.length; i += 8) {
    const batch = await Promise.all(
      entries.slice(i, i + 8).map(async (entry) => {
        try {
          const result = await research(entry.id).summary();
          if (result.ok) return result.data;
        } catch {
          /* Keep the study accessible when its status cannot be read. */
        }
        return { ...entry, status: "unavailable" as const };
      }),
    );
    summaries.push(...batch);
  }
  return summaries;
}
export const handleStudiesGet: RequestHandler = async (event) => {
  await requireAdmin(event);
  return Response.json(await listResearchStudies(), { headers: { "Cache-Control": "no-store" } });
};
export const handleStudiesPost: RequestHandler = async (event) => {
  await requireAdmin(event);
  const parsed = ResearchBrief.safeParse(await readJson(event.request, 16000));
  if (!parsed.success) error(400, "请填写想研究的问题，并检查补充内容。");
  const id = crypto.randomUUID().replaceAll("-", "");
  const pending = researchData(await research(id).begin(id, parsed.data));
  await directory().researchAdd({ id, topic: pending.topic, createdAt: pending.createdAt });
  return Response.json(pending, { status: 202 });
};
export const handleStudyGet: RequestHandler = async (event) => {
  await requireAdmin(event);
  return Response.json(researchData(await research(event.params.id).inspect()));
};
export const handleStudyPost: RequestHandler = async (event) => {
  await requireAdmin(event);
  const data = (await readJson(event.request, 512000)) as {
    action?: unknown;
    title?: unknown;
    targets?: unknown;
    plan?: unknown;
    reviewed?: unknown;
    answer?: unknown;
    instruction?: unknown;
    participation?: unknown;
    note?: unknown;
  };
  const stub = research(event.params.id);
  if (data?.action === "share") {
    researchData(await stub.publicInfo());
    return Response.json({ path: "/r/" + (await directory().researchShare(event.params.id!)) });
  }
  if (data?.action === "remove-empty-responses")
    return Response.json(researchData(await stub.removeEmptyResponses(data.targets)));
  if (data?.action === "collection-note")
    return Response.json(researchData(await stub.addCollectionNote(data.note)));
  if (data?.action === "clarify")
    return Response.json(researchData(await stub.clarify(data.answer)));
  if (data?.action === "refine")
    return Response.json(researchData(await stub.refine(data.instruction)));
  if (data?.action === "cancel-refinement")
    return Response.json(researchData(await stub.cancelRefinement()));
  if (data?.action === "retry") return Response.json(researchData(await stub.retry()));
  if (data?.action === "save") return Response.json(researchData(await stub.update(data.plan)));
  if (data?.action === "rename") return Response.json(researchData(await stub.rename(data.title)));
  if (data?.action === "publish") {
    if (data.reviewed !== true) error(400, "请先确认研究目的、核心题、数据用途及预试安排。");
    return Response.json(researchData(await stub.publish(data.participation)));
  }
  if (data?.action === "close") return Response.json(researchData(await stub.close()));
  error(400, "未知操作。");
};
export const handleStudyDelete: RequestHandler = async (event) => {
  await requireAdmin(event);
  researchData(await research(event.params.id).remove());
  await directory().researchRemove(event.params.id!);
  return Response.json({ deleted: true });
};
export const handleExport: RequestHandler = async (event) => {
  await requireAdmin(event);
  const format = event.url.searchParams.get("format") === "csv" ? "csv" : "json";
  const text = researchData(await research(event.params.id).exportData(format));
  return new Response(text, {
    headers: {
      "Content-Type":
        format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="research-${event.params.id}.${format}"`,
    },
  });
};
export const handleInterviewGet: RequestHandler = async (event) =>
  Response.json(researchData(await research(event.params.id).readSession(session(event))));
export const handleInterviewPost: RequestHandler = async (event) => {
  const data = (await readJson(event.request, 65536)) as {
    action?: unknown;
    eligible?: unknown;
    consent?: unknown;
    answer?: unknown;
    timeZone?: unknown;
    presence?: unknown;
  };
  const stub = research(event.params.id);
  if (
    ["start", "answer", "revise"].includes(String(data?.action)) &&
    event.request.headers.get("X-Mira-Research-Protocol") !== RESEARCH_PROTOCOL
  )
    return Response.json(
      { message: "页面已更新，请刷新后继续。已提交的回答会保留。" },
      { status: 409, headers: { "X-Mira-Research-Reload": "1" } },
    );
  if (data?.action === "start") {
    const existing = event.cookies.get(interviewCookie(event.params.id!));
    const token =
      existing && /^[0-9a-f]{64}$/.test(existing)
        ? existing
        : crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    const ip = event.getClientAddress();
    const day = new Date().toISOString().slice(0, 10);
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${adminToken()}|${event.params.id}|${day}|${ip}`),
    );
    const rateKey = Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, "0")).join(
      "",
    );
    const result = researchData(
      await stub.start(token, rateKey, {
        eligible: data.eligible,
        consent: data.consent,
        timeZone: data.timeZone,
      }),
    );
    event.cookies.set(interviewCookie(event.params.id!), token, {
      path: "/",
      httpOnly: true,
      secure: event.url.protocol === "https:",
      sameSite: "strict",
      maxAge: 365 * 86400,
    });
    return Response.json(result);
  }
  if (data?.action === "presence")
    return Response.json(researchData(await stub.recordPresence(session(event), data.presence)));
  if (data?.action === "answer")
    return Response.json(researchData(await stub.answer(session(event), data.answer)));
  if (data?.action === "revise")
    return Response.json(researchData(await stub.revise(session(event), data.answer)));
  if (data?.action === "resume")
    return Response.json(researchData(await stub.resume(session(event))));
  if (data?.action === "finish")
    return Response.json(researchData(await stub.finish(session(event))));
  error(400, "未知操作。");
};
export const handleWithdraw: RequestHandler = async (event) => {
  researchData(await research(event.params.id).withdraw(session(event)));
  event.cookies.delete(interviewCookie(event.params.id!), { path: "/" });
  return Response.json({ withdrawn: true });
};
