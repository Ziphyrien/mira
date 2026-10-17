import { expect, test, type BrowserContext } from "@playwright/test";

let cookies: Awaited<ReturnType<BrowserContext["cookies"]>>;
test.beforeAll(async ({ request }) => {
  const response = await request.post("/api/onboard", { data: { name: "语音输入验收", focus: [], style: "balanced", timezone: "UTC" } });
  expect(response.status()).toBe(200);
  cookies = (await request.storageState()).cookies;
});
test.beforeEach(async ({ context }) => { await context.addCookies(cookies); });
test.use({ permissions: ["microphone"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

for (const selection of [[2, 5], [2, 2]]) {
  test(`records without network setup and replaces range ${selection.join(":")} on completion`, async ({ page }) => {
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "消息", exact: true });
    await input.fill("前面旧文字后面");
    await input.evaluate((node: HTMLTextAreaElement, range) => node.setSelectionRange(range[0], range[1]), selection);
    const requests: string[] = [];
    page.on("request", request => requests.push(request.url()));
    page.on("websocket", socket => requests.push(socket.url()));
    await page.context().setOffline(true);
    await page.getByRole("button", { name: "语音输入", exact: true }).click();
    const finish = page.getByRole("button", { name: "完成语音输入", exact: true });
    await expect(finish).toBeEnabled();
    await expect(finish).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("00:01", { exact: true })).toBeVisible();
    expect(requests).toEqual([]);
    await expect(input).toHaveValue("前面旧文字后面");
    await page.context().setOffline(false);
    await page.route("**/api/speech/transcribe", async route => {
      expect(route.request().headers()["content-type"]).toMatch(/^audio\/(webm|mp4|ogg)/);
      expect(route.request().postDataBuffer()!.length).toBeGreaterThan(100);
      await route.fulfill({ json: { text: "识别文字" } });
    });
    await finish.click();
    const expected = selection[1] === 5 ? "前面识别文字后面" : "前面识别文字旧文字后面";
    await expect(input).toHaveValue(expected);
    await expect(input).toBeEditable();
    await expect(input).toBeFocused();
    await expect(page.locator("article")).toHaveCount(0);
    await page.reload();
    await expect(input).toHaveValue(expected);
    expect(await page.pageErrors()).toEqual([]);
  });
}

test("cancels recording and pending transcription, restores selection and releases the microphone", async ({ page }) => {
  await page.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getUserMedia(constraints);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); performance.mark("microphone-stopped"); };
      }
      return stream;
    };
  });
  const release = Promise.withResolvers<void>();
  await page.route("**/api/speech/transcribe", async route => {
    await release.promise;
    await route.fulfill({ json: { text: "迟到的识别结果" } }).catch(() => {});
  });
  try {
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "消息", exact: true });
    await input.fill("前面旧文字后面");
    await input.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 5));
    for (const phase of ["recording", "transcribing"]) {
      await page.getByRole("button", { name: "语音输入", exact: true }).click();
      await expect(page.getByText("00:01", { exact: true })).toBeVisible();
      let aborted: Promise<unknown> | undefined;
      if (phase === "transcribing") {
        const pending = page.waitForRequest("**/api/speech/transcribe");
        await page.getByRole("button", { name: "完成语音输入", exact: true }).click();
        await pending;
        aborted = page.waitForEvent("requestfailed", request => request.url().endsWith("/api/speech/transcribe"));
      }
      await page.keyboard.press("Escape");
      await aborted;
      await expect(input).toHaveValue("前面旧文字后面");
      await expect(input).toBeEditable();
      await expect(input).toBeFocused();
      expect(await input.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([2, 5]);
    }
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName("microphone-stopped").length)).toBeGreaterThanOrEqual(2);
    release.resolve();
    await page.unrouteAll({ behavior: "wait" });
    await expect(input).toHaveValue("前面旧文字后面");
  } finally { release.resolve(); }
});

test("preserves the draft after microphone permission denial and transcription failure", async ({ page }) => {
  await page.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let denied = false;
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (!denied) { denied = true; throw new DOMException("Denied", "NotAllowedError"); }
      return getUserMedia(constraints);
    };
  });
  await page.route("**/api/speech/transcribe", route => route.fulfill({ status: 502 }));
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("保留草稿");
  await page.getByRole("button", { name: "语音输入", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请允许麦克风访问");
  await expect(input).toHaveValue("保留草稿");
  await page.getByRole("button", { name: "语音输入", exact: true }).click();
  await expect(page.getByText("00:01", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "完成语音输入", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("暂时无法识别语音");
  await expect(input).toHaveValue("保留草稿");
  await expect(input).toBeEditable();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
});
