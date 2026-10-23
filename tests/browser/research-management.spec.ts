import { test, expect } from "@playwright/test";
import { adminToken } from "./fixture";
import { brief, plan } from "../research-fixture";

test("shared study management survives refresh, scopes access, analyzes a close and resumes collection", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.request.post("/api/admin/session", { data: { token: adminToken } });
  const { id } = await (await page.request.post("/api/research", { data: brief })).json();
  await expect
    .poll(async () => (await (await page.request.get("/api/research/" + id)).json()).status)
    .toBe("ready");
  const other = await (await page.request.post("/api/research", { data: brief })).json();
  const title = plan.title + " · 共享验证";
  await page.request.post("/api/research/" + id, { data: { action: "rename", title } });
  await page.request.post("/api/research/" + id, { data: { action: "publish", reviewed: true } });
  await page.goto("/research");
  await page
    .getByRole("group", { name: title, exact: true })
    .getByRole("button", { name: "分享管理", exact: true })
    .click();
  const link = await page.getByRole("textbox", { name: "研究管理链接" }).inputValue();
  expect(link).toContain("/research/" + id + "/access/");
  const shared = await browser.newContext({
    extraHTTPHeaders: { "X-Mira-Research-Protocol": "2" },
  });
  const manager = await shared.newPage();
  manager.on("pageerror", (error) => errors.push(error.message));
  expect((await shared.request.get("/api/research/" + id)).status()).toBe(401);
  await manager.goto(link);
  await expect(manager).toHaveURL(new RegExp("/research/" + id + "$"));
  await expect(manager.getByRole("heading", { name: title, exact: true })).toBeVisible();
  expect((await shared.request.get("/api/research")).status()).toBe(401);
  expect((await shared.request.get("/api/research/" + other.id)).status()).toBe(401);
  expect(
    (
      await shared.request.post("/api/research/" + other.id, {
        data: { action: "management-share" },
      })
    ).status(),
  ).toBe(401);
  const participant = await browser.newContext({
    extraHTTPHeaders: { "X-Mira-Research-Protocol": "2" },
  });
  expect(
    (
      await participant.request.post("/api/research/public/" + id, {
        data: { action: "start", eligible: true, consent: true },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await participant.request.post("/api/research/public/" + id, {
        data: { action: "answer", answer: { questionId: "autonomy", value: 3 } },
      })
    ).ok(),
  ).toBe(true);
  await manager.getByRole("tab", { name: /数据/ }).click();
  await manager.reload();
  await expect(manager.getByRole("tab", { name: /数据/ })).toHaveAttribute("data-state", "active");
  await manager.getByRole("button", { name: "结束收集", exact: true }).click();
  await manager.getByRole("dialog").getByRole("button", { name: "结束收集", exact: true }).click();
  await expect(manager.getByRole("tab", { name: "分析", exact: true })).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(
    manager.getByText("本轮数据显示了参与者已提供的工作体验。", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await manager.reload();
  await expect(manager.getByRole("tab", { name: "分析", exact: true })).toHaveAttribute(
    "data-state",
    "active",
  );
  const exported = await (
    await shared.request.get("/api/research/" + id + "/export?format=json")
  ).json();
  expect(exported.analyses[0]).toMatchObject({ status: "ready", sessions: 1, answers: 1 });
  await manager.getByRole("button", { name: "继续收集", exact: true }).click();
  await expect(manager.getByRole("button", { name: "结束收集", exact: true })).toBeVisible();
  expect(
    (
      await participant.request.post("/api/research/public/" + id, {
        data: { action: "answer", answer: { questionId: "burden", value: 2 } },
      })
    ).ok(),
  ).toBe(true);
  await manager.getByRole("button", { name: "删除研究", exact: true }).click();
  await manager.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click();
  await expect(manager.getByText("这项研究已删除。", { exact: true })).toBeVisible();
  expect((await shared.request.get("/api/research/" + id)).status()).toBe(401);
  expect((await shared.request.get(link)).status()).toBe(404);
  expect(errors).toEqual([]);
  await shared.close();
  await participant.close();
});
