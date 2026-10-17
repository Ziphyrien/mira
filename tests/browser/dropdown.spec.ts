import { expect, test } from "@playwright/test";
import { adminToken } from "./fixture.ts";

test("saves both grouped model selections and disables them while saving", async ({ page }) => {
  expect(
    (await page.request.post("/api/admin/session", { data: { token: adminToken } })).status(),
  ).toBe(200);
  const original = await (await page.request.get("/api/admin/models")).json();
  const release = Promise.withResolvers<void>();
  try {
    await page.goto("/admin");
    const chat = page.getByRole("combobox", { name: "日常聊天模型", exact: true });
    const memory = page.getByRole("combobox", { name: "记忆压缩模型", exact: true });
    await chat.click();
    const chatOptions = page.getByRole("listbox", { name: "日常聊天模型选项" });
    const dimensions = await chatOptions.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
      return { width: node.clientWidth, contentWidth: node.scrollWidth };
    });
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.width + 1);
    await expect(chatOptions.getByRole("group", { name: "DeepSeek", exact: true })).toHaveCount(1);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(chat).toContainText("deepseek-v4-pro");
    await expect(chatOptions).not.toBeVisible();
    await memory.click();
    await page
      .getByRole("option", { name: "DeepSeek V4.1 Flash · deepseek-flash", exact: true })
      .click();
    await expect(memory).toContainText("deepseek-flash");
    await page.route("**/api/admin/models", async (route) => {
      if (route.request().method() === "PUT") await release.promise;
      await route.continue();
    });
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/models") && response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(chat).toBeDisabled();
    await expect(memory).toBeDisabled();
    release.resolve();
    const response = await saved;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({
      chat: { provider: "deepseek", modelId: "deepseek-v4-pro" },
      memory: { provider: "deepseek", modelId: "deepseek-flash" },
    });
    await page.reload();
    await expect(chat).toContainText("deepseek-v4-pro");
    await expect(memory).toContainText("deepseek-flash");
    expect(await page.pageErrors()).toEqual([]);
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: "wait" });
    expect(
      (
        await page.request.put("/api/admin/models", {
          data: { keys: {}, chat: original.chat, memory: original.memory },
        })
      ).status(),
    ).toBe(200);
  }
});

for (const pointer of ["mouse", "touch"] as const) {
  test.describe(`voice dropdown with ${pointer}`, () => {
    test.use({ hasTouch: pointer === "touch" });

    test("keeps the voice dropdown above settings, inside the viewport, and saves selection", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      expect(
        (
          await page.request.post("/api/onboard", {
            data: { name: "通用下拉验收", focus: [], style: "balanced", timezone: "UTC" },
          })
        ).status(),
      ).toBe(200);
      await page.goto("/");
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "设置", exact: true });
      const voice = page.getByRole("combobox", { name: "音色", exact: true });
      if (pointer === "touch") await voice.tap();
      else await voice.click();
      const options = page.getByRole("listbox", { name: "音色选项" });
      await expect(options).toBeVisible();
      await options.evaluate(async (node) => {
        await Promise.all(node.getAnimations().map((animation) => animation.finished));
      });
      const bounds = await options.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(7);
      expect(bounds!.y).toBeGreaterThanOrEqual(7);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(368);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(660);
      // Visibility alone does not detect a listbox covered by the dialog's stacking layer.
      const chloe = page.getByRole("option", { name: "Chloe · 英文女声", exact: true });
      if (pointer === "touch") await chloe.tap({ timeout: 3000 });
      else await chloe.click({ timeout: 3000 });
      await expect(voice).toContainText("Chloe · 英文女声");
      await expect(options).not.toBeVisible();
      if (pointer === "touch") await voice.tap();
      else await voice.click();
      await expect(options).toBeVisible();
      const lastOption = page.getByRole("option", { name: "Dean · 英文男声", exact: true });
      const inactiveBackground = await lastOption.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      );
      await page.keyboard.press("End");
      await expect
        .poll(() => lastOption.evaluate((node) => getComputedStyle(node).backgroundColor))
        .not.toBe(inactiveBackground);
      await expect(voice).toHaveAttribute(
        "aria-activedescendant",
        (await page
          .getByRole("option", { name: "Dean · 英文男声", exact: true })
          .getAttribute("id"))!,
      );
      await page.keyboard.press("Escape");
      await expect(options).not.toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(voice).toBeFocused();
      await voice.click();
      await page.keyboard.type("Mia");
      await expect(voice).toHaveAttribute(
        "aria-activedescendant",
        (await page
          .getByRole("option", { name: "Mia · 英文女声", exact: true })
          .getAttribute("id"))!,
      );
      await page.keyboard.press("Enter");
      await expect(voice).toContainText("Mia · 英文女声");
      const saved = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/speech/settings") && response.request().method() === "PUT",
      );
      await page.getByRole("button", { name: "保存语音设置", exact: true }).click();
      expect((await saved).request().postDataJSON().voice).toBe("Mia");
      await expect(page.getByRole("status")).toContainText("语音设置已保存");
      await page.reload();
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await expect(voice).toContainText("Mia · 英文女声");
      expect(await page.pageErrors()).toEqual([]);
    });
  });
}
