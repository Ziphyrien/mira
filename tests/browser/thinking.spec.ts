import { expect, test, type Page } from "@playwright/test";
import { adminToken } from "./fixture.ts";

async function openAccount(page: Page) {
  const response = await page.request.post("/api/onboard", {
    data: { name: "思考档位验收", focus: [], style: "balanced", timezone: "UTC" },
  });
  expect(response.status()).toBe(200);
  await page.goto("/");
  await expect(page.getByLabel("思考档位", { exact: true })).toBeVisible();
}

// Browser ownership: the stored preference must reach the actual chat request after a reload.
test("restores the selected thinking level after reload and uses it for the next request", async ({
  page,
}) => {
  await openAccount(page);
  const picker = page.getByLabel("思考档位", { exact: true });
  await picker.click();
  await page.getByRole("option", { name: "关闭", exact: true }).click();
  await expect(picker).toContainText("关闭");
  await page.reload();
  await expect(picker).toContainText("关闭");
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("思考档位持久化验收");
  const request = page.waitForRequest(
    (value) => value.url().endsWith("/api/chat") && value.method() === "POST",
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  expect((await request).postDataJSON().thinking).toBe("off");
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
  expect(await page.pageErrors()).toEqual([]);
});

test("remembers each model's thinking level independently", async ({ page }) => {
  await openAccount(page);
  const picker = page.getByLabel("思考档位", { exact: true });
  await picker.click();
  await page.getByRole("option", { name: "关闭", exact: true }).click();
  await expect(picker).toContainText("关闭");
  expect(
    (await page.request.post("/api/admin/session", { data: { token: adminToken } })).status(),
  ).toBe(200);
  const original = await (await page.request.get("/api/admin/models")).json();
  try {
    const changed = await page.request.put("/api/admin/models", {
      data: {
        keys: {},
        chat: { provider: "deepseek", modelId: "deepseek-v4-pro" },
        memory: original.memory,
      },
    });
    expect(changed.status()).toBe(200);
    await page.reload();
    await expect(picker).toContainText("高");
    await picker.click();
    await page.getByRole("option").last().click();
    await expect(picker).toContainText("最高");
  } finally {
    expect(
      (
        await page.request.put("/api/admin/models", {
          data: { keys: {}, chat: original.chat, memory: original.memory },
        })
      ).status(),
    ).toBe(200);
  }
  await page.reload();
  await expect(picker).toContainText("关闭");
  expect(await page.pageErrors()).toEqual([]);
});

test("keeps thinking selection usable when browser storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage denied", "SecurityError");
      },
    });
  });
  await openAccount(page);
  const picker = page.getByLabel("思考档位", { exact: true });
  await picker.click();
  await page.getByRole("option", { name: "关闭", exact: true }).click();
  await expect(picker).toContainText("关闭");
  expect(await page.pageErrors()).toEqual([]);
});

test("finishes the thinking menu exit before hiding it and reopens with the current selection painted", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openAccount(page);
  const picker = page.getByLabel("思考档位", { exact: true });
  await picker.click();
  const menu = page.getByRole("listbox", { name: "思考档位选项" });
  await expect(menu).toBeVisible();
  const activeColor = await menu
    .getByRole("option", { selected: true })
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  await menu.evaluate(async (node) => {
    await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  const closingFrames = menu.evaluate(async (node) => {
    await new Promise((resolve) => node.addEventListener("pointerup", resolve, { once: true }));
    const frames: { visible: boolean; opacity: number }[] = [];
    for (let frame = 0; frame < 60; frame++) {
      await new Promise(requestAnimationFrame);
      const visible = node.checkVisibility();
      frames.push({ visible, opacity: Number(getComputedStyle(node).opacity) });
      if (!visible) break;
    }
    return { frames, connected: node.isConnected };
  });
  await menu.getByRole("option", { name: "关闭", exact: true }).click();
  const closing = await closingFrames;
  expect(
    closing.frames.some((frame) => frame.visible && frame.opacity > 0 && frame.opacity < 1),
  ).toBe(true);
  expect(closing.frames.at(-1)?.visible).toBe(false);
  expect(closing.connected).toBe(false);
  await expect(picker).toContainText("关闭");
  await expect(picker).toBeFocused();
  const reopened = await picker.evaluate(async (node) => {
    if (!(node instanceof HTMLElement)) throw new Error("Thinking trigger must be an HTML element");
    node.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const selected = document
      .getElementById(node.getAttribute("aria-controls")!)!
      .querySelector<HTMLElement>('[role="option"][aria-selected="true"]')!;
    return {
      text: selected.textContent?.trim(),
      color: getComputedStyle(selected).backgroundColor,
    };
  });
  expect(reopened.text).toBe("关闭");
  expect(reopened.color).toBe(activeColor);
  await picker.press("Escape");
  await expect(menu).not.toBeVisible();
  await picker.press("ArrowDown");
  await expect(picker).toHaveAttribute(
    "aria-activedescendant",
    (await page.getByRole("option", { name: "关闭", exact: true }).getAttribute("id"))!,
  );
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(menu).not.toBeVisible();
  await expect(picker).toBeFocused();
  expect(await page.pageErrors()).toEqual([]);
});

test("reverses an interrupted thinking menu exit and respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openAccount(page);
  const picker = page.getByLabel("思考档位", { exact: true });
  await picker.click();
  const reversal = await picker.evaluate(async (node) => {
    if (!(node instanceof HTMLElement)) throw new Error("Thinking trigger must be an HTML element");
    const menu = document.getElementById(node.getAttribute("aria-controls")!)!;
    await Promise.all(menu.getAnimations().map((animation) => animation.finished));
    node.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const exiting = {
      visible: menu.checkVisibility(),
      opacity: Number(getComputedStyle(menu).opacity),
    };
    node.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(menu.getAnimations().map((animation) => animation.finished));
    return {
      exiting,
      connected: menu.isConnected,
      visible: menu.checkVisibility(),
      opacity: getComputedStyle(menu).opacity,
    };
  });
  expect(reversal.exiting.visible).toBe(true);
  expect(reversal.exiting.opacity).toBeGreaterThan(0);
  expect(reversal.exiting.opacity).toBeLessThan(1);
  expect(reversal.connected).toBe(true);
  expect(reversal.visible).toBe(true);
  expect(reversal.opacity).toBe("1");
  const menu = page.getByRole("listbox", { name: "思考档位选项" });
  await expect(menu).toHaveCount(1);
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await expect(menu).not.toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await picker.press("ArrowDown");
  await expect(menu).toBeVisible();
  const reduced = await picker.evaluate(async (node) => {
    if (!(node instanceof HTMLElement)) throw new Error("Thinking trigger must be an HTML element");
    const menu = document.getElementById(node.getAttribute("aria-controls")!)!;
    node.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { connected: menu.isConnected, animations: menu.getAnimations().length };
  });
  expect(reduced).toEqual({ connected: false, animations: 0 });
  expect(await page.pageErrors()).toEqual([]);
});
