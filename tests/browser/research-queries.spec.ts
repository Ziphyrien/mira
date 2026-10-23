import { test, expect } from "@playwright/test";
import { adminToken } from "./fixture";
import { brief, plan } from "../research-fixture";

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
