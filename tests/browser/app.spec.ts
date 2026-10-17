import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import {
  adminToken,
  baseURL,
  cancellationPrompt,
  imageProfile,
  replyPrefix,
  retryPromptPrefix,
  scrollPrompt,
  richPrompt,
} from "./fixture.ts";

async function createAccount(page: Page, name: string) {
  const response = await page.request.post("/api/onboard", {
    data: { name, focus: [], style: "balanced", timezone: "Asia/Shanghai" },
  });
  expect(response.status()).toBe(200);
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible();
}

async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "消息", exact: true }).fill(text);
  const response = page.waitForResponse(
    (value) => value.url().endsWith("/api/chat") && value.request().method() === "POST",
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  expect((await response).status()).toBe(200);
}

test.afterEach(async ({ page }) => {
  expect(await page.pageErrors()).toEqual([]);
});

test("onboards, sends, regenerates from both rows, searches and restores persisted history", async ({
  page,
}) => {
  const initial = await page.request.get("/");
  expect(initial.headers()["cache-control"]).toContain("private");
  expect(initial.headers()["cache-control"]).toContain("no-store");
  expect(await initial.text()).toContain("你好，我是 Mira");
  const scripts = /\/_app\/immutable\/.*\.js(?:\?.*)?$/;
  const release = Promise.withResolvers<void>();
  await page.route(scripts, async (route) => {
    await release.promise;
    await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.getByRole("button", { name: "开始", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "已有账户点我", exact: true })).toBeDisabled();
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
  await page.getByRole("button", { name: "开始", exact: true }).click();
  await page.getByRole("textbox", { name: "我该怎么称呼你？" }).fill("浏览器验收");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: "跳过", exact: true }).click();
  await page.getByRole("button", { name: "开始聊天", exact: true }).click();
  await send(page, "你好，验证完整对话链路");
  await expect(page.locator("article").last()).toContainText(replyPrefix);
  await expect(page.getByRole("button", { name: "重新生成", exact: true })).toHaveCount(2);
  let reply = (await page.locator("article").last().textContent())!.trim();

  for (const [index, kind] of [
    [0, "question"],
    [1, "reply"],
  ] as const) {
    const response = page.waitForResponse(
      (value) => value.url().endsWith("/api/chat") && value.request().method() === "POST",
    );
    await page.getByRole("button", { name: "重新生成", exact: true }).nth(index).click();
    const result = await response;
    expect(result.status()).toBe(200);
    expect(result.request().postDataJSON().prompt.kind).toBe(kind);
    await expect(page.locator("article").last()).toContainText(replyPrefix);
    await expect(page.locator("article").last()).not.toHaveText(reply);
    await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
    reply = (await page.locator("article").last().textContent())!.trim();
  }

  const persisted = await (await page.request.get("/api/me")).json();
  expect(persisted.messages).toHaveLength(2);
  expect(persisted.messages.at(-1).text).toBe(reply);
  expect(persisted.busy).toBe(false);
  await page.getByRole("button", { name: "搜索对话", exact: true }).click();
  const search = page.getByRole("dialog", { name: "搜索对话", exact: true });
  await search.getByRole("searchbox", { name: "搜索内容" }).fill("完整对话链路");
  await search.getByRole("button", { name: /验证完整对话链路/ }).click();
  await expect(search).not.toBeVisible();
  await page.reload();
  await expect(page.locator("article")).toHaveCount(2);
  await expect(page.locator("article").last()).toHaveText(reply);
});

test("prefetches summaries without blocking chat, shares pending work and refreshes after a reply", async ({
  page,
}) => {
  const release = Promise.withResolvers<void>();
  let requests = 0;
  await page.route("**/api/memory/tree", async (route) => {
    requests++;
    if (requests === 1) await release.promise;
    await route.continue();
  });
  const releaseNodes = Promise.withResolvers<void>();
  const nodeRequests: string[] = [];
  let holdNodes = false;
  await page.route("**/api/memory/tree?*", async (route) => {
    nodeRequests.push(new URL(route.request().url()).search);
    if (holdNodes) await releaseNodes.promise;
    await route.continue();
  });
  const summary = page.getByRole("region", { name: "记忆摘要树" });
  const open = () => page.getByRole("button", { name: "查看摘要视图", exact: true }).click();
  const close = () => page.getByRole("button", { name: "返回聊天视图", exact: true }).click();
  try {
    await createAccount(page, "摘要预取验收");
    await expect.poll(() => requests, { timeout: 5000 }).toBe(1);
    await expect(summary).toHaveCount(0);
    await open();
    await expect(summary.getByText("正在读取摘要", { exact: true })).toBeVisible();
    expect(requests).toBe(1);
    const first = page.waitForResponse("**/api/memory/tree");
    release.resolve();
    const initial = await (await first).json();
    await expect(summary.getByRole("button", { name: "刷新摘要视图" })).toBeEnabled();
    await expect(summary.getByRole("button", { name: /^展开摘要 / })).toHaveCount(
      initial.nodes.length,
    );
    await close();
    await open();
    await expect(summary.getByRole("button", { name: "刷新摘要视图" })).toBeEnabled();
    expect(requests).toBe(1);
    await close();

    nodeRequests.length = 0;
    holdNodes = true;
    const updated = page.waitForResponse("**/api/memory/tree");
    await send(page, "更新摘要预取的对话");
    await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
    const latest = await (await updated).json();
    expect(latest.total).toBeGreaterThan(initial.total);
    const node = latest.nodes[0];
    const query = `?id=${node.id}&n=${node.n}`;
    await expect.poll(() => nodeRequests.includes(query)).toBe(true);
    const loaded = page.waitForResponse((response) =>
      response.url().endsWith(`/api/memory/tree${query}`),
    );
    releaseNodes.resolve();
    expect((await loaded).status()).toBe(200);
    await open();
    await summary
      .getByRole("button", { name: `展开摘要 ${node.id}+${node.n}`, exact: true })
      .click();
    const expanded = page.locator(`[id="memory-${node.id}+${node.n}"]`);
    await expect(expanded).toBeVisible();
    await expect(expanded.getByText("正在展开", { exact: true })).toHaveCount(0);
    expect(nodeRequests.filter((value) => value === query)).toHaveLength(1);
    await summary.getByRole("button", { name: "全部折叠", exact: true }).click();

    await expect(summary.getByRole("button", { name: "刷新摘要视图" })).toBeEnabled();
    await expect(summary.getByRole("button", { name: /^展开摘要 / })).toHaveCount(
      latest.nodes.length,
    );
    expect(requests).toBe(2);
    const downloadReady = page.waitForEvent("download");
    await summary.getByRole("link", { name: "导出记忆", exact: true }).click();
    const download = await downloadReady;
    expect(download.suggestedFilename()).toBe("mira-memory.json");
    const exported = JSON.parse(readFileSync((await download.path())!, "utf8"));
    expect(
      exported.messages.some((message: { text: string }) => message.text === "更新摘要预取的对话"),
    ).toBe(true);
    expect(exported.summaries.length).toBeGreaterThan(0);
    await close();
    await send(page, "导入时应该被替换的临时消息");
    await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
    await open();
    await page.getByLabel("选择记忆备份", { exact: true }).setInputFiles({
      name: "mira-memory.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(exported)),
    });
    const confirm = page.getByRole("alertdialog", { name: "导入记忆", exact: true });
    await expect(confirm).toContainText(`${exported.messages.length} 条记录`);
    const imported = page.waitForResponse("**/api/memory/import");
    await confirm.getByRole("button", { name: "确认导入", exact: true }).click();
    expect((await imported).status()).toBe(200);
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible();
    await expect(page.locator("article")).toHaveCount(2);
    await expect(page.getByText("导入时应该被替换的临时消息", { exact: true })).toHaveCount(0);
    await send(page, "恢复后继续聊天");
    await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
    await expect(page.locator("article")).toHaveCount(4);
  } finally {
    release.resolve();
    releaseNodes.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("retries an unsuccessful accepted request without duplicating the user message", async ({
  page,
}) => {
  await createAccount(page, "失败重试验收");
  await send(page, `${retryPromptPrefix} ${crypto.randomUUID()}`);
  const failure = page.getByRole("alert");
  await expect(failure).toContainText("这次没有顺利回复，请再试一次。");
  const retry = page.waitForResponse(
    (value) => value.url().endsWith("/api/chat") && value.request().method() === "POST",
  );
  await failure.getByRole("button", { name: "重试", exact: true }).click();
  expect((await retry).status()).toBe(200);
  await expect(page.locator("article").last()).toContainText(replyPrefix);
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
  const state = await (await page.request.get("/api/me")).json();
  expect(state.messages).toHaveLength(2);
  expect(state.busy).toBe(false);
  expect(state.messages.at(-1).text).toContain(replyPrefix);
});

test("follows streamed Markdown growth and preserves the reader's position after scrolling up", async ({
  page,
}) => {
  await createAccount(page, "滚动验收");
  await send(page, scrollPrompt);
  const viewport = page.locator('main[aria-live="polite"]');
  await expect(page.locator("article").last()).toContainText("第 8 段");
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeVisible();
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
    .toBeLessThan(5);
  await viewport.hover();
  await page.mouse.wheel(0, -500);
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
    .toBeGreaterThan(300);
  const top = await viewport.evaluate((node) => node.scrollTop);
  await expect(page.locator("article").last()).toContainText("第 30 段");
  await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeCloseTo(top, 0);
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
  await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeCloseTo(top, 0);
});

test("prepares and sends an image through the Worker and restores the stored image", async ({
  page,
  browser,
}) => {
  await createAccount(page, imageProfile);
  const buffer = await sharp({
    create: { width: 40, height: 32, channels: 3, background: "#4676a0" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("选择图片文件", { exact: true })
    .setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer });
  await expect(page.getByRole("img", { name: "待发送图片预览", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("刷新后继续发送这张图片");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveValue(
    "刷新后继续发送这张图片",
  );
  await expect(page.getByRole("img", { name: "待发送图片预览", exact: true })).toBeVisible();
  await send(page, "描述这张图片");
  await expect(page.locator("article").last()).toContainText(replyPrefix);
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
  const state = await (await page.request.get("/api/me")).json();
  expect(state.messages[0].image).toMatchObject({ width: 40, height: 32 });
  const imagePath = `/api/images/${state.messages[0].image.id}`;
  const image = await page.request.get(imagePath);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/jpeg");
  const other = await browser.newContext({ baseURL });
  try {
    expect((await other.request.get(imagePath)).status()).toBe(401);
  } finally {
    await other.close();
  }
  await page.reload();
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveValue("");
  await expect(page.getByRole("img", { name: "待发送图片预览", exact: true })).toHaveCount(0);
  const restored = page.getByRole("img", { name: "上传的图片", exact: true });
  await expect(restored).toBeVisible();
  await expect
    .poll(() => restored.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBe(40);
});

test("isolates SSR and replaces feature state when switching or deleting an account", async ({
  page,
  browser,
}) => {
  await createAccount(page, "第一账户");
  await send(page, "第一账户的私密消息");
  await expect(page.locator("article").last()).toContainText(replyPrefix);
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "查看摘要视图", exact: true }).click();
  await expect(page.getByRole("button", { name: "刷新摘要视图" })).toBeEnabled();
  await page.getByRole("button", { name: "返回聊天视图", exact: true }).click();
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("不应传入第二账户的草稿");
  const firstKey = (await (await page.request.get("/api/key")).json()).key;

  const other = await browser.newContext({ baseURL });
  try {
    const created = await other.request.post("/api/onboard", {
      data: { name: "第二账户", focus: [], style: "balanced", timezone: "Asia/Shanghai" },
    });
    expect(created.status()).toBe(200);
    const { key } = await (await other.request.get("/api/key")).json();
    const html = await (await other.request.get("/")).text();
    expect(html).toContain("第二账户");
    expect(html).not.toContain("第一账户的私密消息");
    expect(html).not.toContain(key);
    expect(html).not.toContain("synthetic-key");

    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    await settings.getByRole("textbox", { name: "已有的密钥", exact: true }).fill(key);
    await settings.getByRole("button", { name: "切换", exact: true }).click();
    await expect(page.getByRole("heading", { name: /第二账户/ })).toBeVisible();
    await expect(page.locator("article")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveValue("");
    expect((await (await page.request.get("/api/me")).json()).profile.name).toBe("第二账户");
    const secondTree = await (await page.request.get("/api/memory/tree")).json();
    await page.getByRole("button", { name: "查看摘要视图", exact: true }).click();
    const summary = page.getByRole("region", { name: "记忆摘要树" });
    await expect(summary.getByRole("button", { name: "刷新摘要视图" })).toBeEnabled();
    await expect(summary.getByRole("button", { name: /^展开摘要 / })).toHaveCount(
      secondTree.nodes.length,
    );
    await expect(summary).not.toContainText("第一账户的私密消息");
    await page.getByRole("button", { name: "返回聊天视图", exact: true }).click();

    await page.getByRole("textbox", { name: "消息", exact: true }).fill("第二账户自己的草稿");
    for (const [accountKey, expected] of [
      [firstKey, "不应传入第二账户的草稿"],
      [key, "第二账户自己的草稿"],
    ]) {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await settings.getByRole("textbox", { name: "已有的密钥", exact: true }).fill(accountKey);
      await settings.getByRole("button", { name: "切换", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveValue(expected);
    }

    await page.getByRole("button", { name: "设置", exact: true }).click();
    await settings.getByRole("button", { name: "删除全部数据", exact: true }).click();
    const confirmation = page.getByRole("alertdialog", { name: "删除全部数据", exact: true });
    await expect(confirmation.getByRole("button", { name: "取消", exact: true })).toBeFocused();
    await confirmation.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page.getByRole("heading", { name: "你好，我是 Mira", exact: true })).toBeVisible();
    const anonymous = await (await page.request.get("/api/me")).json();
    expect(anonymous.profile).toBeNull();
    expect(anonymous.messages).toEqual([]);
    const saved = await page.evaluate(
      () =>
        new Promise<unknown[]>((resolve, reject) => {
          const request = indexedDB.open("mira-drafts");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const read = db.transaction("drafts").objectStore("drafts").getAll();
            read.onsuccess = () => {
              resolve(read.result);
              db.close();
            };
            read.onerror = () => {
              reject(read.error);
              db.close();
            };
          };
        }),
    );
    expect(saved).toEqual([{ version: 1, text: "不应传入第二账户的草稿", image: null }]);
  } finally {
    await other.close();
  }
});

test("renders streamed math, highlights and copies code, draws diagrams and preserves unsupported source", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const requested = new Set<string>();
  page.on("request", (request) => requested.add(new URL(request.url()).pathname));
  const manifest = JSON.parse(
    readFileSync(".svelte-kit/output/client/.vite/manifest.json", "utf8"),
  ) as Record<string, { file: string }>;
  const renderers = ["Math.svelte", "Mermaid.svelte", "highlight.ts"].map(
    (file) => `/${manifest[`src/lib/ui/markdown/${file}`].file}`,
  );
  await createAccount(page, "富文本验收");
  for (const file of renderers) expect(requested.has(file)).toBe(false);
  await send(page, richPrompt);
  await expect.poll(() => renderers.every((file) => requested.has(file))).toBe(true);
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
  const reply = page.locator("article").last();
  await expect(reply).toContainText("富文本验收完成。");
  await expect(reply.locator(".katex")).toHaveCount(2);
  await expect(reply.locator("pre.shiki")).toHaveCount(2);
  await expect(reply.getByRole("figure", { name: "Mermaid 图表" }).locator("svg")).toBeVisible();
  await expect(reply.getByLabel("图表源码")).toContainText("unsupported diagram source");
  await expect(reply.locator("pre.shiki").nth(1)).toContainText("<img src=x onerror=alert(1)>");
  await expect(reply.locator("img")).toHaveCount(0);
  await reply.getByRole("button", { name: "复制代码", exact: true }).first().click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n")).toBe(
    'const greeting: string = "你好";\nconsole.log(greeting);',
  );
  await page.reload();
  await expect(page.locator("article").last().locator(".katex")).toHaveCount(2);
  await expect(
    page.locator("article").last().getByRole("figure", { name: "Mermaid 图表" }),
  ).toBeVisible();
});

test("resumes a live generation after page reload and in-app refresh, then persists its stopped partial reply", async ({
  page,
}) => {
  await createAccount(page, "停止验收");
  await send(page, cancellationPrompt);
  await expect(page.locator("article").last()).toContainText("正在生成的片段");
  await page.reload();
  await expect(page.locator("article").last()).toContainText("正在生成的片段");
  await page.route("**/api/chat", (route) => route.abort("connectionreset"));
  try {
    await page.reload();
    await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeVisible();
  } finally {
    await page.unroute("**/api/chat");
  }
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.locator("article").last()).toContainText("正在生成的片段");
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已停止生成");
  const state = await (await page.request.get("/api/me")).json();
  expect(state.busy).toBe(false);
  expect(state.messages).toHaveLength(2);
  expect(state.messages.at(-1)).toMatchObject({ text: "正在生成的片段", stopped: true });
  await page.reload();
  await expect(page.locator("article").last()).toContainText("正在生成的片段");
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
});

test("authenticates administration, clears filters and opens details by keyboard without exposing credentials", async ({
  page,
  browser,
}) => {
  await createAccount(page, "后台筛选验收");
  const other = await browser.newContext({ baseURL });
  try {
    const created = await other.request.post("/api/onboard", {
      data: { name: "后台保留验收", focus: [], style: "balanced", timezone: "Asia/Shanghai" },
    });
    expect(created.status()).toBe(200);
  } finally {
    await other.close();
  }
  await page.goto("/admin");
  await page.getByLabel("管理令牌", { exact: true }).fill(adminToken);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "搜索空间" })).toBeVisible();
  const htmlResponse = await page.request.get("/admin");
  expect(htmlResponse.headers()["cache-control"]).toContain("no-store");
  const html = await htmlResponse.text();
  expect(html).not.toContain(adminToken);
  expect(html).not.toContain("synthetic-key");
  const initialList = (await (await page.request.get("/api/admin/spaces")).json()) as {
    items: { id: string }[];
  };
  const warmed = Promise.all(
    initialList.items.map(async ({ id }) => {
      const response = await page.waitForResponse((value) =>
        value.url().endsWith(`/api/admin/spaces/${id}`),
      );
      expect(response.status()).toBe(200);
      await response.finished();
    }),
  );
  await page.reload();
  await warmed;
  await expect(page.getByLabel("管理令牌", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "搜索空间" })).toBeVisible();
  const query = page.getByRole("textbox", { name: "搜索空间" });
  await query.fill("后台筛选验收");
  await query.press("Enter");
  await expect(
    page.getByRole("button", { name: "查看空间 后台筛选验收", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看空间 后台保留验收", exact: true }),
  ).toHaveCount(0);
  const firstSpace = page.getByRole("button", { name: /^查看空间 / }).first();
  const detailRequests = new Map<string, number>();
  const completedDetails = new Set<string>();
  let firstId = "";
  let releaseDetail!: () => void;
  let detailFinished!: () => void;
  let detailGate = new Promise<void>((resolve) => {
    releaseDetail = resolve;
  });
  let detailDone = new Promise<void>((resolve) => {
    detailFinished = resolve;
  });
  let failDetail = false;
  await page.route(/\/api\/admin\/spaces\/[^/?]+$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    detailRequests.set(id, (detailRequests.get(id) ?? 0) + 1);
    const gate = detailGate;
    const fail = failDetail;
    const done = detailFinished;
    const response = await route.fetch();
    await gate;
    if (fail) {
      await route.fulfill({ status: 503, json: { message: "详情暂时不可用" } });
    } else {
      await route.fulfill({ response });
    }
    completedDetails.add(id);
    if (id === firstId) done();
  });
  const listed = page.waitForResponse(/\/api\/admin\/spaces\?q=$/);
  await query.fill("");
  await query.press("Enter");
  const list = (await (await listed).json()) as { items: { id: string }[] };
  firstId = list.items[0]!.id;
  await expect(
    page.getByRole("button", { name: "查看空间 后台保留验收", exact: true }),
  ).toBeVisible();
  // Loading the list starts detail requests before any row is hovered or focused.
  await expect.poll(() => detailRequests.get(firstId)).toBe(1);
  await expect(firstSpace).not.toBeFocused();
  await query.press("Tab");
  await page.keyboard.press("Tab");
  await expect(firstSpace).toBeFocused();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.keyboard.press("Enter");
  const detailDialog = page.getByRole("dialog");
  await expect(page.getByRole("dialog")).toBeVisible();
  // The first list already warmed the cache; a pending refresh keeps its detail visible.
  await expect(detailDialog.getByRole("status")).toHaveCount(0);
  await expect(detailDialog.getByRole("button", { name: "删除空间" })).toBeVisible();
  await expect(
    detailDialog.getByRole("button", { name: "关闭", exact: true }).first(),
  ).toBeVisible();
  expect(detailRequests.get(firstId)).toBe(1);
  releaseDetail();
  await detailDone;
  await expect
    .poll(() => [...completedDetails].sort())
    .toEqual(list.items.map(({ id }) => id).sort());
  expect([...detailRequests.values()]).toEqual(list.items.map(() => 1));
  await expect(detailDialog.getByRole("button", { name: "删除空间" })).toBeVisible();

  // The populated detail stays intact until its exit transition completes.
  async function closeWithoutShrinking() {
    const closing = await detailDialog.evaluate(async (node) => {
      if (!(node instanceof HTMLElement)) throw new Error("Expected an HTML dialog");
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
      const before = { text: node.textContent, height: node.offsetHeight };
      (node.querySelector(".modal-action button:last-child") as HTMLButtonElement).click();
      const frames: { text: string | null; height: number; opacity: number }[] = [];
      for (let frame = 0; frame < 60; frame++) {
        await new Promise(requestAnimationFrame);
        if (!node.isConnected) break;
        frames.push({
          text: node.textContent,
          height: node.offsetHeight,
          opacity: Number(getComputedStyle(node).opacity),
        });
      }
      return { before, frames, connected: node.isConnected };
    });
    expect(closing.connected).toBe(false);
    expect(closing.frames.some((frame) => frame.opacity > 0 && frame.opacity < 1)).toBe(true);
    for (const frame of closing.frames)
      expect({ text: frame.text, height: frame.height }).toEqual(closing.before);
    await expect(firstSpace).toBeFocused();
  }
  await closeWithoutShrinking();

  await firstSpace.click();
  await expect(detailDialog.getByRole("button", { name: "删除空间" })).toBeVisible();
  await expect(detailDialog.getByRole("status")).toHaveCount(0);
  expect(detailRequests.get(firstId)).toBe(1);
  await closeWithoutShrinking();

  // Refresh prefetches the whole list again. Background failures stay silent.
  failDetail = true;
  const refresh = page.waitForResponse(/\/api\/admin\/spaces\?q=/);
  const prefetched = page.waitForResponse((response) =>
    response.url().endsWith(`/api/admin/spaces/${firstId}`),
  );
  await query.press("Enter");
  await refresh;
  await (await prefetched).finished();
  await expect.poll(() => detailRequests.get(firstId)).toBe(2);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await firstSpace.click();
  await expect(detailDialog.getByRole("alert")).toHaveText("详情暂时不可用");
  expect(detailRequests.get(firstId)).toBe(3);
  failDetail = false;
  detailGate = new Promise<void>((resolve) => {
    releaseDetail = resolve;
  });
  detailDone = new Promise<void>((resolve) => {
    detailFinished = resolve;
  });
  await detailDialog.getByRole("button", { name: "重试", exact: true }).click();
  await expect.poll(() => detailRequests.get(firstId)).toBe(4);
  await expect(detailDialog.getByRole("button", { name: "删除空间" })).toBeVisible();
  await closeWithoutShrinking();
  releaseDetail();
  await detailDone;
  await expect(detailDialog).not.toBeVisible();
  await firstSpace.click();
  await expect(detailDialog.getByRole("button", { name: "删除空间" })).toBeVisible();
  const conversationTab = detailDialog.getByRole("tab", { name: "对话", exact: true });
  await conversationTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(detailDialog.getByRole("tab", { name: "记忆视图", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(detailDialog.getByRole("tabpanel", { name: "记忆视图", exact: true })).toBeVisible();
  await detailDialog.getByRole("button", { name: "删除空间", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "删除空间", exact: true });
  await expect(confirmation.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).not.toBeVisible();
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog.getByRole("button", { name: "删除空间", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(firstSpace).toBeFocused();
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("管理令牌", { exact: true })).toBeVisible();
  expect((await page.request.get("/api/admin/models")).status()).toBe(401);
});
