import { test, expect } from "@playwright/test";
import { adminToken } from "./fixture";
import { brief, plan } from "../research-fixture";

test("prefetches every listed study without interaction and opens cached or pending details", async ({ page }) => {
  test.setTimeout(90000);
  await page.request.post("/api/admin/session", { data: { token: adminToken } });
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const { id } = await (await page.request.post("/api/research", { data: brief })).json();
    ids.push(id);
    await expect.poll(async () => (await (await page.request.get("/api/research/" + id)).json()).status).toBe("ready");
    await page.request.post("/api/research/" + id, { data: { action: "rename", title: "预取验证 " + id } });
  }
  const listed = await (await page.request.get("/api/research")).json() as { id: string }[];
  const reads = new Map<string, number>();
  const release = Promise.withResolvers<void>();
  await page.route(/\/api\/research\/[a-f0-9]{32}$/, async route => {
    if (route.request().method() !== "GET") return route.continue();
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    reads.set(id, (reads.get(id) ?? 0) + 1);
    const response = await route.fetch();
    if (id === ids[0] || (id === ids[2] && reads.get(id)! > 1)) await release.promise;
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    const ready = page.waitForResponse(response => response.url().endsWith("/api/research/" + ids[2]) && response.status() === 200);
    await page.goto("/research");
    await expect.poll(() => listed.every(study => reads.get(study.id) === 1)).toBe(true);
    await ready;
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/research");
    await page.getByRole("button", { name: "刷新研究列表", exact: true }).click();
    await refreshed;
    expect(listed.every(study => reads.get(study.id) === 1)).toBe(true);
    await page.getByRole("group", { name: "预取验证 " + ids[2], exact: true }).getByRole("button", { name: new RegExp(ids[2]) }).click();
    await expect(page.getByRole("heading", { name: "预取验证 " + ids[2], exact: true })).toBeVisible();
    await page.getByRole("button", { name: "返回研究列表", exact: true }).click();
    await page.getByRole("group", { name: "预取验证 " + ids[0], exact: true }).getByRole("button", { name: new RegExp(ids[0]) }).click();
    await expect(page.getByRole("status", { name: "加载中", exact: true })).toBeVisible();
    expect(reads.get(ids[0])).toBe(1);
    release.resolve();
    await expect(page.getByRole("heading", { name: "预取验证 " + ids[0], exact: true })).toBeVisible();
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("returns to the cached list before refreshing and loads a list when entered from a direct study link", async ({ page }) => {
  await page.request.post("/api/admin/session", { data: { token: adminToken } });
  const { id } = await (await page.request.post("/api/research", { data: brief })).json();
  await expect.poll(async () => (await (await page.request.get("/api/research/" + id)).json()).status).toBe("ready");
  const originalTitle = "返回缓存验证 " + id;
  expect((await page.request.post("/api/research/" + id, { data: { action: "rename", title: originalTitle } })).ok()).toBe(true);
  await page.goto("/research");
  await page.getByRole("group", { name: originalTitle, exact: true }).getByRole("button", { name: new RegExp(originalTitle) }).click();
  await expect(page).toHaveURL(new RegExp("/research/" + id + "$"));
  const title = "后台刷新后的研究标题";
  expect((await page.request.post("/api/research/" + id, { data: { action: "rename", title } })).ok()).toBe(true);
  const release = Promise.withResolvers<void>();
  let serverLoads = 0;
  await page.route(url => url.pathname === "/research/__data.json" || url.pathname === "/api/research", async route => {
    if (new URL(route.request().url()).pathname === "/research/__data.json") serverLoads++;
    await release.promise;
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "返回研究列表", exact: true }).click();
    await expect(page).toHaveURL(/\/research$/);
    await expect(page.getByRole("group", { name: originalTitle, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "刷新研究列表", exact: true })).toBeDisabled();
    expect(serverLoads).toBe(0);
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(page.getByRole("group", { name: title, exact: true })).toBeVisible();
  await page.goto("/research/" + id);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const coldRelease = Promise.withResolvers<void>();
  await page.route("**/api/research", async route => { await coldRelease.promise; await route.continue(); });
  try {
    await page.getByRole("button", { name: "返回研究列表", exact: true }).click();
    await expect(page).toHaveURL(/\/research$/);
    await expect(page.getByRole("status", { name: "加载研究列表", exact: true })).toBeVisible();
    await expect(page.getByText("还没有研究", { exact: true })).toHaveCount(0);
  } finally {
    coldRelease.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(page.getByRole("group", { name: title, exact: true })).toBeVisible();
});

test("focus refreshes share one request and a stale read cannot overwrite a saved study", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.request.post("/api/admin/session", { data: { token: adminToken } });
  const { id } = await (await page.request.post("/api/research", { data: brief })).json();
  await expect
    .poll(async () => (await (await page.request.get("/api/research/" + id)).json()).status)
    .toBe("ready");
  const pending = Promise.withResolvers<void>(),
    started = Promise.withResolvers<void>();
  let reads = 0;
  await page.route("**/api/research/" + id, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    reads++;
    if (reads !== 1) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    started.resolve();
    await pending.promise;
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    await page.goto("/research/" + id);
    await started.promise;
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.getByRole("button", { name: "修改展示标题", exact: true }).click();
    await page.getByLabel("参与者看到的标题", { exact: true }).fill("保存后保留的新标题");
    expect(reads).toBe(1);
    await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "保存后保留的新标题", exact: true }),
    ).toBeVisible();
    pending.resolve();
    await expect(page.getByRole("heading", { name: plan.title, exact: true })).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "保存后保留的新标题", exact: true }),
    ).toBeVisible();
  } finally {
    pending.resolve();
  }
});
