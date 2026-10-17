import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Row } from "../../src/lib/contracts/messages.ts";

const rows: Row[] = Array.from({ length: 600 }, (_, index) => ({
  i: index + 1,
  kind: index % 2 === 0 ? "user" : "mira",
  text:
    index === 5
      ? "最早定位目标：海边的咖啡"
      : `第 ${index + 1} 条历史消息\n\n${"中文长对话与 mixed English 用于验证布局。".repeat(4)}${index % 2 ? "\n\n- 保持阅读位置\n- 按需挂载历史消息" : ""}`,
  at: 1_700_000_000_000 + index * 60_000,
}));

async function openHistory(page: Page, messages = rows, initialCount = 80) {
  await page.route("**/api/onboard", async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({
      response,
      json: {
        ...state,
        messages: messages.slice(-initialCount),
        nextBefore: initialCount < messages.length ? messages.at(-initialCount)!.i : null,
      },
    });
  });
  await page.route("**/api/history?*", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const before = Number(query.get("before") ?? 601);
    const limit = Number(query.get("limit") ?? 80);
    const page = messages.filter((row) => row.i < before).slice(-limit);
    await route.fulfill({
      json: { messages: page, nextBefore: page[0].i > 1 ? page[0].i : null },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "开始", exact: true }).click();
  await page.getByRole("textbox", { name: "我该怎么称呼你？" }).fill("长历史验收");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: "跳过", exact: true }).click();
  await page.getByRole("button", { name: "开始聊天", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible();
  await expect(page.locator('[id="m-600"]')).toBeVisible();
}

test("keeps long history bounded while locating an unmounted search result and returning to recent messages", async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await openHistory(page);
  const initial = await page.locator('main[aria-live="polite"] article').count();
  const before = await cdp.send("Performance.getMetrics");
  const started = performance.now();
  await page.getByRole("button", { name: "搜索对话", exact: true }).click();
  const search = page.getByRole("dialog", { name: "搜索对话", exact: true });
  await search.getByRole("searchbox", { name: "搜索内容" }).fill("最早定位目标");
  await search.getByRole("button", { name: /最早定位目标/ }).click();
  await expect(search).not.toBeVisible();
  await expect(page.locator('[id="m-6"]')).toBeVisible();
  const mounted = await page.locator('main[aria-live="polite"] article').count();
  const after = await cdp.send("Performance.getMetrics");
  const metric = (name: string) =>
    (after.metrics.find((entry) => entry.name === name)?.value ?? 0) -
    (before.metrics.find((entry) => entry.name === name)?.value ?? 0);
  const receipt = {
    initial,
    mounted,
    history: rows.length,
    navigationMs: performance.now() - started,
    scriptMs: metric("ScriptDuration") * 1000,
    layoutMs: metric("LayoutDuration") * 1000,
    taskMs: metric("TaskDuration") * 1000,
    layoutCount: metric("LayoutCount"),
  };
  mkdirSync(".pi/fabric/performance", { recursive: true });
  writeFileSync(
    `.pi/fabric/performance/${process.env.MIRA_PERF_LABEL ?? "latest"}.json`,
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt));
  expect(mounted).toBeLessThan(60);
  const viewport = page.locator('main[aria-live="polite"]');
  await viewport.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(page.locator('[id="m-600"]')).toBeVisible();
  await expect
    .poll(() => page.locator('main[aria-live="polite"] article').count())
    .toBeLessThan(60);
  await page.setViewportSize({ width: 440, height: 800 });
  await expect(page.locator('[id="m-600"]')).toBeVisible();
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
    .toBeLessThan(5);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('[id="m-600"]')).toBeVisible();
  expect(await page.pageErrors()).toEqual([]);
});

for (const width of [1280, 440]) {
  test(`opens mixed-height history at the latest message and returns from summaries at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    const mixed = rows.map((row, index) => ({
      ...row,
      text: `第 ${row.i} 条\n\n${"中文与 English 的长短混合内容。".repeat([1, 16, 2, 7, 30, 3, 2, 1][index % 8])}${row.kind === "mira" ? "\n\n- 保持阅读位置\n- 按需挂载" : ""}`,
    }));
    await openHistory(page, mixed, mixed.length);
    const viewport = page.locator('main[aria-live="polite"]');
    const atEnd = () =>
      viewport.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight);
    await expect.poll(atEnd).toBeLessThan(5);
    await page.getByRole("button", { name: "查看摘要视图", exact: true }).click();
    await expect(page.getByRole("region", { name: "记忆摘要树" })).toBeVisible();
    await page.getByRole("button", { name: "返回聊天视图", exact: true }).click();
    await expect(page.locator('[id="m-600"]')).toBeVisible();
    await expect.poll(atEnd).toBeLessThan(5);
    expect(await page.pageErrors()).toEqual([]);
  });
}

test("keeps the visible message in place when an earlier history page is prepended", async ({
  page,
}) => {
  await openHistory(page);
  const release = Promise.withResolvers<void>();
  const requested = Promise.withResolvers<void>();
  await page.route("**/api/history?before=521", async (route) => {
    requested.resolve();
    await release.promise;
    await route.fulfill({ json: { messages: rows.slice(440, 520), nextBefore: 441 } });
  });
  const viewport = page.locator('main[aria-live="polite"]');
  try {
    await viewport.evaluate((node) => {
      node.scrollTop = 0;
    });
    await requested.promise;
    const anchor = page.locator('[id="m-521"]');
    await expect(anchor).toBeVisible();
    const before = (await anchor.boundingBox())!.y;
    release.resolve();
    await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(1000);
    await expect(anchor).toBeVisible();
    await expect
      .poll(async () => Math.abs((await anchor.boundingBox())!.y - before))
      .toBeLessThan(5);
    expect(await page.pageErrors()).toEqual([]);
  } finally {
    release.resolve();
  }
});
