import { expect, test } from "@playwright/test";

// Layout ownership: optional thinking controls must not leave an empty flex item,
// and both ends of the toolbar must retain the same inset at each viewport.
for (const thinking of [true, false]) {
  test(`balances toolbar edges with thinking ${thinking ? "available" : "unavailable"}`, async ({ page }) => {
    await page.route("**/api/onboard", async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const state = await response.json();
      if (!thinking) state.model.thinking = [];
      await route.fulfill({ response, json: state });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "开始", exact: true }).click();
    await page.getByLabel("我该怎么称呼你？").fill("工具栏布局验收");
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await page.getByRole("button", { name: "跳过", exact: true }).click();
    await page.getByRole("button", { name: "开始聊天", exact: true }).click();
    const settings = page.getByRole("button", { name: "设置", exact: true });
    await expect(settings).toBeVisible();
    await expect(page.getByRole("combobox", { name: "思考档位" })).toHaveCount(thinking ? 1 : 0);
    for (const width of [1280, 375, 320]) {
      await page.setViewportSize({ width, height: 800 });
      const layout = await settings.evaluate(button => {
        const toolbar = button.parentElement!;
        const bounds = toolbar.getBoundingClientRect();
        const controls = [...toolbar.querySelectorAll("button")].filter(node => node.getBoundingClientRect().width > 0);
        const first = controls[0]!.getBoundingClientRect();
        const last = button.getBoundingClientRect();
        return {
          left: first.left - bounds.left,
          right: bounds.right - last.right,
          rowSpread: Math.max(...controls.map(node => Math.abs(node.getBoundingClientRect().top - first.top))),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect.soft(Math.abs(layout.left - layout.right), `${width}px edge balance: ${JSON.stringify(layout)}`).toBeLessThan(0.5);
      expect.soft(layout.rowSpread, `${width}px toolbar stays on one row`).toBeLessThan(0.5);
      expect.soft(layout.overflow).toBe(false);
    }
    expect(await page.pageErrors()).toEqual([]);
  });
}
