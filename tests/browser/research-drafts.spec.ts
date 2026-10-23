import { test, expect } from "@playwright/test";
import { adminToken } from "./fixture";
import { brief, plan } from "../research-fixture";

test("research creation and plan edits survive reopening, clear after save and reject outdated drafts", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.request.post("/api/admin/session", { data: { token: adminToken } });
  await page.goto("/research");
  await page.getByRole("button", { name: "新建研究", exact: true }).click();
  await page.getByLabel("想了解什么？", { exact: true }).fill("草稿恢复验证");
  await page.getByLabel("补充背景（选填）", { exact: true }).fill("这段背景需要在关闭页面后保留。");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "新建研究", exact: true }).click();
  await expect(page.getByLabel("补充背景（选填）", { exact: true })).toHaveValue(
    "这段背景需要在关闭页面后保留。",
  );
  await page.reload();
  await page.getByRole("button", { name: "新建研究", exact: true }).click();
  await expect(page.getByLabel("想了解什么？", { exact: true })).toHaveValue("草稿恢复验证");
  await page.getByRole("button", { name: "准备方案", exact: true }).click();
  await expect(page.getByRole("heading", { name: plan.title, exact: true })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.getByRole("button", { name: "返回研究列表", exact: true }).click();
  await page.getByRole("button", { name: "新建研究", exact: true }).click();
  await expect(page.getByLabel("想了解什么？", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.goto("/research/" + id);
  await page.getByRole("button").filter({ hasText: plan.questions[0].prompt }).click();
  await page.getByRole("button", { name: "编辑题目", exact: true }).click();
  await page.getByLabel("说明", { exact: true }).fill("尚未保存的题目说明");
  await page.reload();
  await page.getByRole("button").filter({ hasText: plan.questions[0].prompt }).click();
  await expect(page.getByText("已恢复本地草稿", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "编辑题目", exact: true }).click();
  await expect(page.getByLabel("说明", { exact: true })).toHaveValue("尚未保存的题目说明");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button").filter({ hasText: plan.questions[0].prompt }).click();
  await expect(page.getByText("已恢复本地草稿", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "编辑题目", exact: true }).click();
  await page.getByLabel("说明", { exact: true }).fill("应失效的旧版本草稿");
  await page.keyboard.press("Escape");
  const current = await (await page.request.get("/api/research/" + id)).json();
  current.study.plan.questions[0].help = "另一位管理者保存的新版本";
  await page.request.post("/api/research/" + id, {
    data: { action: "save", plan: current.study.plan },
  });
  await page.reload();
  await page.getByRole("button").filter({ hasText: plan.questions[0].prompt }).click();
  await page.getByRole("button", { name: "编辑题目", exact: true }).click();
  await expect(page.getByLabel("说明", { exact: true })).toHaveValue("另一位管理者保存的新版本");
  expect(errors).toEqual([]);
});

test("an unsubmitted response survives closing its tab and withdrawal clears it for the next participation", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await page.request.post("/api/admin/session", { data: { token: adminToken } });
  const { id } = await (await page.request.post("/api/research", { data: brief })).json();
  await expect
    .poll(async () => (await (await page.request.get("/api/research/" + id)).json()).status)
    .toBe("ready");
  await page.request.post("/api/research/" + id, { data: { action: "publish", reviewed: true } });
  const { path } = await (
    await page.request.post("/api/research/" + id, { data: { action: "share" } })
  ).json();
  await page.request.post("/api/research/public/" + id, {
    data: { action: "start", eligible: true, consent: true },
  });
  await page.goto(path);
  await page.getByRole("radio", { name: "5", exact: true }).check();
  // Reload first observes the write, then a fresh tab proves recovery beyond sessionStorage.
  await page.reload();
  await expect(page.getByRole("radio", { name: "5", exact: true })).toBeChecked();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(path);
  await expect(reopened.getByRole("radio", { name: "5", exact: true })).toBeChecked();
  await reopened.getByRole("button", { name: "继续", exact: true }).click();
  await expect(reopened.getByText(plan.questions[1].prompt, { exact: true })).toBeVisible();
  await reopened.getByRole("radio", { name: "2", exact: true }).check();
  await reopened.getByRole("button", { name: "参与说明", exact: true }).click();
  await reopened.getByRole("button", { name: "撤回回答", exact: true }).click();
  await reopened.getByRole("button", { name: "撤回", exact: true }).click();
  await expect(reopened.getByRole("heading", { name: "已撤回", exact: true })).toBeVisible();
  await reopened.reload();
  await reopened.getByLabel("我符合参与条件").check();
  await reopened.getByLabel("我已阅读参与说明，同意参加").check();
  await reopened.getByRole("button", { name: "开始", exact: true }).click();
  await expect(reopened.getByRole("radio", { name: "5", exact: true })).not.toBeChecked();
});
