import { test, expect } from "@playwright/test";
import { adminToken, baseURL, retryPromptPrefix, cancellationPrompt } from "./fixture";
import { brief, plan } from "../research-fixture";

test("shows a nonverbal loading state until scripts can activate controls", async ({ page }) => {
  await page.request.post("/api/admin/session", { data: { token: adminToken } });
  const ready = Promise.withResolvers<void>();
  await page.route("**/_app/immutable/**/*.js", async (route) => {
    await ready.promise;
    await route.continue();
  });
  try {
    await page.goto("/research", { waitUntil: "commit" });
    await expect(page.getByRole("status", { name: "正在加载", exact: true })).toBeVisible();
    await expect(page.locator("[inert]")).toHaveCount(1);
  } finally {
    ready.resolve();
  }
  await expect(page.getByRole("status", { name: "正在加载", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "新建研究", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
test("research flows through administrator review, seven controls, resume, export and withdrawal", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const unauthorized = await page.request.get("/api/research");
  expect(unauthorized.status()).toBe(401);
  await page.goto("/research");
  await expect(page.getByRole("heading", { name: "登录研究工作台" })).toBeVisible();
  expect(
    (await page.request.post("/api/admin/session", { data: { token: adminToken } })).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "新建研究" }).click();
  await page.getByLabel("想了解什么？", { exact: true }).fill(brief.topic);
  await page
    .getByLabel("补充背景（选填）", { exact: true })
    .fill(brief.population + "。" + brief.purpose);
  await page.getByRole("button", { name: "准备方案", exact: true }).click();
  await expect(page.getByRole("heading", { name: plan.title, exact: true })).toBeVisible();
  await page.getByRole("button").filter({ hasText: plan.questions[0].prompt }).click();
  await page.getByRole("button", { name: "编辑题目", exact: true }).click();
  await page.getByLabel("说明", { exact: true }).fill("请回想最近两周的工作日。");
  await page.getByRole("button", { name: "作答安排", exact: true }).click();
  await page.getByRole("button", { name: "移除此选项", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const id = (await (await page.request.get("/api/research")).json())[0].id;
  const saved = await (await page.request.get("/api/research/" + id)).json();
  const newTitle = plan.title + "（已调整）";
  const populationReview = "供研究者核对：招募渠道尚待确认，不能据此设定年龄条件。";
  await page.request.post("/api/research/" + id, {
    data: {
      action: "save",
      plan: { ...saved.study.plan, title: newTitle, population: populationReview },
    },
  });
  await page.getByRole("button", { name: "返回研究列表" }).click();
  const row = page.getByRole("button", { name: newTitle });
  await expect(row).toBeVisible();
  await expect(row).toContainText("待发布");
  await expect(page.getByRole("button", { name: /删除研究/ })).toHaveCount(0);
  await row.click();
  await expect(page.getByRole("heading", { name: newTitle, exact: true })).toBeVisible();
  await page.screenshot({ path: ".pi/fabric/research-plan.png", fullPage: true });
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await page.getByLabel("研究者联系方式").fill(brief.contact);
  await page.getByLabel("回答保存多少天？").fill(String(brief.retentionDays));
  await page.getByLabel("已审阅方案与参与说明，完成发布准备").check();
  await page.getByRole("dialog").getByRole("button", { name: "发布", exact: true }).click();
  const href = await page.getByRole("link", { name: "打开参与页面" }).getAttribute("href");
  expect(href).toMatch(/^\/r\/[A-Za-z0-9_-]{11}$/);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button").filter({ hasText: plan.questions[0].prompt }).click();
  const detail = page.getByRole("dialog");
  await expect(
    detail.getByRole("heading", { name: plan.questions[0].prompt, exact: true }),
  ).toBeVisible();
  await expect(detail.getByRole("textbox")).toHaveCount(0);
  await detail.getByRole("button", { name: "作答安排", exact: true }).click();
  await expect(
    detail.getByText(plan.questions[0].responsePolicy.rationale, { exact: true }),
  ).toBeVisible();
  await detail.getByRole("button", { name: "收集用途", exact: true }).click();
  await expect(detail.getByText(plan.questions[0].purpose, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: ".pi/fabric/research-question-detail.png", fullPage: true });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(
    (await (await page.request.post("/api/research/" + id, { data: { action: "share" } })).json())
      .path,
  ).toBe(href);
  const participant = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 320, height: 740 },
  });
  const user = await participant.newPage();
  user.on("pageerror", (e) => errors.push(e.message));
  expect((await participant.request.get("/api/research/" + id + "/export")).status()).toBe(401);
  const response = await user.goto(href!);
  expect(response!.headers()["cache-control"]).toContain("no-store");
  await expect(user.getByText(brief.population, { exact: true })).toBeVisible();
  await expect(user.getByText(populationReview, { exact: true })).toHaveCount(0);
  await expect(user.getByRole("checkbox", { name: "我符合参与条件" })).toHaveCount(0);
  await user.getByLabel("我已阅读参与说明，同意参加").check();
  await user.getByRole("button", { name: "开始" }).click();
  const pageState = async () => {
    const response = await page.request.get("/api/research/" + id + "/export?format=json");
    return (await response.json()).participants[0].observation.state;
  };
  await expect.poll(pageState).toBe("ongoing");
  await user.goto("about:blank");
  await expect.poll(pageState).toBe("paused");
  await user.goto(href!);
  await expect.poll(pageState).toBe("ongoing");
  const next = user.getByRole("button", { name: "继续", exact: true });
  await expect(user.getByText(plan.questions[0].prompt, { exact: true })).toBeVisible();
  await expect(user.getByRole("button", { name: "跳过", exact: true })).toHaveCount(0);
  await expect(next).toBeDisabled();
  await user.screenshot({ path: ".pi/fabric/research-question-mobile.png", fullPage: true });
  expect(await user.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await user.getByRole("radio", { name: "5", exact: true }).press("Space");
  await user.reload();
  await expect(user.getByRole("radio", { name: "5", exact: true })).toBeChecked();
  await next.click();
  await expect(user.getByText(plan.questions[1].prompt, { exact: true })).toBeVisible();
  await user.getByRole("button", { name: "上一题", exact: true }).click();
  await expect(user.getByRole("radio", { name: "5", exact: true })).toBeChecked();
  await user.getByRole("radio", { name: "4", exact: true }).check();
  await user.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(user.getByText(plan.questions[1].prompt, { exact: true })).toBeVisible();
  await user.reload();
  await expect(user.getByText(plan.questions[1].prompt, { exact: true })).toBeVisible();
  await user.goto(href!);
  await expect(user.getByText(plan.questions[1].prompt, { exact: true })).toBeVisible();
  await user.getByRole("radio", { name: "1", exact: true }).check();
  await next.click();
  await expect(user.getByRole("slider")).toBeVisible();
  await expect(next).toBeDisabled();
  await user.getByRole("slider").fill("75");
  await next.click();
  await user.getByRole("radio", { name: "是", exact: true }).check();
  await next.click();
  await user.getByRole("checkbox", { name: "文字聊天" }).check();
  await user.getByRole("checkbox", { name: "视频会议" }).check();
  await next.click();
  await user.getByRole("combobox").click();
  await user.getByRole("option", { name: "少于10人" }).click();
  await next.click();
  await user.getByRole("spinbutton").fill("3");
  await next.click();
  await user.getByRole("textbox", { name: "你的回答" }).fill("我希望有更多专注时间。");
  await next.click();
  await expect(user.getByText("哪种情况最能解释刚才的体验？", { exact: true })).toBeVisible();
  await user.getByRole("combobox").click();
  await user.getByRole("option", { name: "需要专注时间" }).click();
  await next.click();
  await expect(user.getByRole("heading", { name: "访谈已结束" })).toBeVisible();
  const exported = await page.request.get("/api/research/" + id + "/export?format=json");
  expect(exported.ok()).toBe(true);
  const data = await exported.json();
  expect(data.participants).toHaveLength(1);
  expect(data.participants[0].answers).toHaveLength(9);
  expect(data.participants[0].fallbackCount).toBe(0);
  expect(data.statistics.constructs[0].summary.mean).toBeCloseTo(83.3333, 3);
  expect(data.participants[0].answers.at(-1).question.source).toBe("probe");
  const credentials = (await participant.cookies()).filter((c) =>
    c.name.startsWith("mira_interview_"),
  );
  expect(credentials).toHaveLength(1);
  expect(credentials[0].httpOnly).toBe(true);
  expect(JSON.stringify(data)).not.toContain(credentials[0].value);
  await user.screenshot({ path: ".pi/fabric/research-mobile.png", fullPage: true });
  expect(await user.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "返回研究列表" }).click();
  await expect(page.getByRole("button", { name: newTitle })).toContainText("收集中");
  await page.getByRole("button", { name: newTitle }).click();
  await page.getByRole("tab", { name: /数据/ }).click();
  await page.getByRole("button", { name: "刷新数据" }).click();
  await expect(page.getByText("83.33", { exact: true })).toBeVisible();
  const participantTitle = "聊聊你的混合办公体验";
  await expect(page.getByRole("button", { name: "修改展示标题" })).toBeVisible();
  await page.getByRole("button", { name: "修改展示标题" }).click();
  await page.getByLabel("参与者看到的标题", { exact: true }).fill(participantTitle);
  await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("heading", { name: participantTitle, exact: true })).toBeVisible();
  const renamed = await (
    await page.request.get("/api/research/" + id + "/export?format=json")
  ).json();
  expect(renamed.study.version).toBe(data.study.version);
  expect(renamed.study.plan).toEqual({ ...data.study.plan, title: participantTitle });
  const stored = (participants: { observation: unknown; [key: string]: unknown }[]) =>
    participants.map(
      ({ observation: _observation, pagePresence: _pagePresence, ...record }) => record,
    );
  expect(stored(renamed.participants)).toEqual(stored(data.participants));
  expect(renamed.observedAt).toBeGreaterThanOrEqual(data.observedAt);
  await user.reload();
  await expect(user.getByRole("heading", { name: participantTitle, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回研究列表" }).click();
  await expect(page.getByRole("button", { name: participantTitle })).toContainText("收集中");
  await page.getByRole("button", { name: participantTitle }).click();
  await page.getByRole("tab", { name: /数据/ }).click();
  await page.screenshot({ path: ".pi/fabric/research-admin.png", fullPage: true });
  await expect(user.getByRole("button", { name: "撤回回答" })).toHaveCount(0);
  await user.getByRole("button", { name: "参与说明" }).click();
  await user.getByRole("button", { name: "撤回回答" }).click();
  await user.getByRole("button", { name: "撤回", exact: true }).click();
  await expect(user.getByRole("heading", { name: "已撤回" })).toBeVisible();
  const after = await (await page.request.get("/api/research/" + id)).json();
  expect(after.results.sessions).toBe(0);
  await page.getByRole("button", { name: "删除研究", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("heading", { name: "研究", exact: true })).toBeVisible();
  expect((await page.request.get(href!)).status()).toBe(404);
  expect((await page.request.get("/research/" + id)).status()).toBe(404);
  expect(errors).toEqual([]);
  await participant.close();
});

test("shows failed planning, refreshes after retry, and deletes a running plan from its preparation page", async ({
  page,
}) => {
  await page.request.post("/api/admin/session", { data: { token: adminToken } });
  const topic = retryPromptPrefix + " " + crypto.randomUUID();
  const { id } = await (
    await page.request.post("/api/research", { data: { ...brief, topic } })
  ).json();
  await expect
    .poll(async () => (await (await page.request.get("/api/research/" + id)).json()).status)
    .toBe("failed");
  await page.goto("/research");
  await expect(page.getByRole("button", { name: topic })).toContainText("生成失败");
  await page.getByRole("button", { name: topic }).click();
  await expect(page.getByRole("heading", { name: "暂时没能生成方案" })).toBeVisible();
  await expect(page.getByRole("button", { name: "删除研究", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("heading", { name: plan.title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "删除研究", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("heading", { name: "研究", exact: true })).toBeVisible();
  const waitingTopic = cancellationPrompt + " " + crypto.randomUUID();
  const waiting = await (
    await page.request.post("/api/research", { data: { ...brief, topic: waitingTopic } })
  ).json();
  await expect(page.getByRole("button", { name: waitingTopic })).toContainText("生成中");
  await expect(page.getByRole("button", { name: /删除研究/ })).toHaveCount(0);
  await page.getByRole("button", { name: waitingTopic }).click();
  await expect(page.getByRole("heading", { name: "正在准备研究方案" })).toBeVisible();
  await page.getByRole("button", { name: "删除研究", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("heading", { name: "研究", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: waitingTopic })).toHaveCount(0);
  expect((await page.request.get("/api/research/" + waiting.id)).status()).toBe(404);
});
test("planned nonresponse protects entered content, routes dependencies and keeps voluntary ending available", async ({
  page,
}) => {
  await page.request.post("/api/admin/session", { data: { token: adminToken } });
  const created = await page.request.post("/api/research", { data: brief });
  const { id } = await created.json();
  await expect
    .poll(async () => (await (await page.request.get("/api/research/" + id)).json()).status)
    .toBe("ready");
  const design = structuredClone(plan);
  design.questions[0].responsePolicy.options = [
    { id: "unknown", label: "记不清", kind: "unknown", next: "continue" },
  ];
  design.questions[1].applicability = {
    all: [{ questionId: "autonomy", operator: "gt", value: 0 }],
    rationale: "依赖前一题的实质回答。",
  };
  design.questions[2].responsePolicy.options = [];
  expect(
    (
      await page.request.post("/api/research/" + id, { data: { action: "save", plan: design } })
    ).ok(),
  ).toBe(true);
  await page.request.post("/api/research/" + id, { data: { action: "publish", reviewed: true } });
  const { path } = await (
    await page.request.post("/api/research/" + id, { data: { action: "share" } })
  ).json();
  await page.goto(path);
  await page.getByLabel("我符合参与条件").check();
  await page.getByLabel("我已阅读参与说明，同意参加").check();
  await page.getByRole("button", { name: "开始" }).click();
  await page.getByRole("radio", { name: "3", exact: true }).check();
  await page.getByRole("button", { name: "记不清", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "继续填写", exact: true }).click();
  await expect(page.getByRole("radio", { name: "3", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "记不清", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByText(plan.questions[2].prompt, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "跳过", exact: true })).toHaveCount(0);
  await expect(page.getByText(/^已回答 0 题\s*·\s*未回答 1 题$/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "接下来，你想怎样继续？" })).toHaveCount(0);
  await page.getByRole("button", { name: "结束访谈", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "结束", exact: true }).click();
  await expect(page.getByRole("heading", { name: "访谈已结束" })).toBeVisible();
  const output = await (await page.request.get("/api/research/" + id + "/export")).json();
  expect(output.participants[0].finishReason).toBe("participant");
  expect(output.participants[0].answers).toHaveLength(1);
  expect(output.participants[0].answers[0]).toMatchObject({
    value: null,
    nonresponse: { id: "unknown", kind: "unknown" },
  });
  expect(output.participants[0].omitted).toContainEqual({
    questionId: "burden",
    reason: "prerequisite_missing",
  });
});
test("researcher answers an Agent clarification and requests a natural-language draft revision", async ({
  page,
}) => {
  await page.request.post("/api/admin/session", { data: { token: adminToken } });
  const response = await page.request.post("/api/research", {
    data: { topic: brief.topic + " [clarify]", background: "这是早期研究想法。" },
  });
  const { id } = await response.json();
  await page.goto("/research");
  await page.getByRole("button", { name: new RegExp("\\[clarify\\]") }).click();
  await expect(page.getByRole("heading", { name: "再了解一点背景" })).toBeVisible();
  await page.getByLabel("你的补充").fill("研究对象是自愿参与的混合办公职员。");
  await page.getByRole("button", { name: "继续准备方案" }).click();
  await expect(page.getByRole("heading", { name: plan.title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "让助手调整方案" }).click();
  await page.getByLabel("希望怎样调整？").fill("请降低作答负担并保留核心构念的覆盖。");
  await page.getByRole("dialog").getByRole("button", { name: "调整方案", exact: true }).click();
  await expect(page.getByRole("heading", { name: "调整后的工作体验", exact: true })).toBeVisible();
  const result = await (await page.request.get("/api/research/" + id)).json();
  expect(result.study.planningContext.exchanges[0].answer).toContain("混合办公职员");
  expect(result.study.planningContext.revision.instruction).toContain("核心构念");
  expect(result.study.sources[0].access).toBe("page_extract");
});
test("closed research rejects further participation while preserving existing participant withdrawal", async ({
  request,
}) => {
  await request.post("/api/admin/session", { data: { token: adminToken } });
  const created = await request.post("/api/research", { data: brief });
  expect(created.status()).toBe(202);
  const { id } = await created.json();
  await expect
    .poll(async () => (await (await request.get("/api/research/" + id)).json()).status)
    .toBe("ready");
  expect((await request.get("/research/" + id)).status()).toBe(200);
  const outdated = await request.post("/api/research/public/" + id, {
    headers: { "X-Mira-Research-Protocol": "1" },
    data: { action: "start", eligible: true, consent: true },
  });
  expect(outdated.status()).toBe(409);
  expect(outdated.headers()["x-mira-research-reload"]).toBe("1");
  expect(
    (await request.post("/api/research/" + id, { data: { action: "publish" } })).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/research/" + id, { data: { action: "publish", reviewed: true } })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post("/api/research/public/" + id, {
        data: { action: "start", eligible: true, consent: true },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await request.delete("/api/research/" + id, { headers: { Origin: baseURL } })).status(),
  ).toBe(409);
  await request.post("/api/research/" + id, { data: { action: "close" } });
  expect(
    (
      await request.post("/api/research/public/" + id, {
        data: { action: "answer", answer: { questionId: "autonomy", value: 3 } },
      })
    ).status(),
  ).toBe(410);
  const withdrawn = await request.delete("/api/research/public/" + id, {
    headers: { Origin: baseURL },
  });
  expect(withdrawn.status(), await withdrawn.text()).toBe(200);
  const before = await (await request.get("/api/research")).json();
  expect((await request.delete("/api/admin/session", { headers: { Origin: baseURL } })).ok()).toBe(
    true,
  );
  expect(
    (await request.delete("/api/research/" + id, { headers: { Origin: baseURL } })).status(),
  ).toBe(401);
  await request.post("/api/admin/session", { data: { token: adminToken } });
  expect((await request.delete("/api/research/" + id, { headers: { Origin: baseURL } })).ok()).toBe(
    true,
  );
  const after = await (await request.get("/api/research")).json();
  expect(after).toEqual(before.filter((entry: { id: string }) => entry.id !== id));
  expect((await request.get("/api/research/" + id)).status()).toBe(404);
  expect((await request.get("/api/research/" + id + "/export")).status()).toBe(404);
  expect((await request.get("/research/" + id)).status()).toBe(404);
});
