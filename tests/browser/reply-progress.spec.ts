import { expect, test, type Page } from "@playwright/test";
import type { StreamEvent } from "../../src/lib/contracts";

// Exercise the browser's real NDJSON consumer and rendering, with controllable network pauses.
async function controlledReply(page: Page) {
  const events: (StreamEvent | null)[] = [];
  let waiting: ((event: StreamEvent | null) => void) | undefined;
  await page.exposeFunction("nextReplyEvent", () => {
    if (events.length) return events.shift();
    return new Promise<StreamEvent | null>((resolve) => {
      waiting = resolve;
    });
  });
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const url = input instanceof Request ? input.url : String(input);
      if (new URL(url, location.href).pathname !== "/api/chat") return original(input, options);
      const next = (window as typeof window & { nextReplyEvent(this: void): Promise<StreamEvent | null> })
        .nextReplyEvent;
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          async pull(controller) {
            const event = await next();
            if (event === null) controller.close();
            else controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          },
        }),
        { headers: { "Content-Type": "application/x-ndjson" } },
      );
    };
  });
  return (event: StreamEvent | null) => {
    if (waiting) {
      const resolve = waiting;
      waiting = undefined;
      resolve(event);
    } else events.push(event);
  };
}

for (const withProcess of [false, true]) {
  test(`replaces the bottom progress line in place ${withProcess ? "after thinking and search" : "for a direct answer"}`, async ({
    page,
  }) => {
    const emit = await controlledReply(page);
    const response = await page.request.post("/api/onboard", {
      data: { name: "回复布局验收", focus: [], style: "balanced", timezone: "UTC" },
    });
    expect(response.status()).toBe(200);
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).fill("验证回复衔接");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    emit({ type: "status", phase: "thinking" });
    const status = page.getByRole("status").filter({ hasText: "正在想" });
    await expect(status).toBeVisible();
    const reply = page.locator("article").last();
    if (withProcess) {
      emit({ type: "thinking", text: "先检查需要确认的信息。", replace: false });
      await expect(reply).toContainText("先检查需要确认的信息。");
      const thought = reply.getByRole("button", { name: "思考过程", exact: true });
      const beforeTool = await thought.boundingBox();
      const search = {
        id: "layout-search",
        query: "参考资料",
        status: "running" as const,
        sources: [],
      };
      emit({ type: "search", search });
      const tool = reply.getByRole("button", { name: "参考资料", exact: true });
      await expect(tool).toBeVisible();
      expect((await thought.boundingBox())!.y).toBeCloseTo(beforeTool!.y, 0);
      expect((await tool.boundingBox())!.y).toBeGreaterThan(beforeTool!.y + beforeTool!.height);
      emit({ type: "search", search: { ...search, status: "done" } });
      emit({ type: "thinking", text: "\n\n根据检索结果继续判断。", replace: false });
      await expect(reply).toContainText("根据检索结果继续判断。");
      await expect(reply.getByRole("button", { name: "思考过程", exact: true })).toHaveCount(1);
      emit({ type: "status", phase: "recall" });
      await expect(
        page.getByRole("status").filter({ hasText: "正在回顾之前的对话" }),
      ).toBeVisible();
      emit({ type: "status", phase: "thinking" });
      await expect(status).toBeVisible();
      const toolBounds = await reply
        .getByRole("button", { name: "参考资料", exact: true })
        .boundingBox();
      expect((await status.boundingBox())!.y).toBeGreaterThanOrEqual(
        toolBounds!.y + toolBounds!.height,
      );
    }
    const before = await status.boundingBox();
    const ready = Promise.withResolvers<void>();
    await page.exposeFunction("replyFramesReady", () => ready.resolve());
    const frames = page.locator("main").evaluate(async (main) => {
      const samples: boolean[] = [];
      const active = () =>
        [...main.querySelectorAll("[role=status]")].some((n) => n.textContent?.includes("正在想"));
      const answer = () =>
        [...main.querySelectorAll("article p")].find((n) =>
          n.textContent?.includes("这是最终回答。"),
        );
      await (window as typeof window & { replyFramesReady(): Promise<void> }).replyFramesReady();
      for (let frame = 0; frame < 120; frame++) {
        await new Promise(requestAnimationFrame);
        samples.push(active() || Boolean(answer()));
        if (answer()) return samples;
      }
      return samples;
    });
    await ready.promise;
    emit({ type: "delta", text: "这是最终回答。" });
    const answer = reply.locator("p").filter({ hasText: "这是最终回答。" });
    await expect(answer).toBeVisible();
    await expect(status).toHaveCount(0);
    const after = await answer.boundingBox();
    expect(after!.x).toBeCloseTo(before!.x, 0);
    expect(after!.y).toBeCloseTo(before!.y, 0);
    expect(after!.height).toBeCloseTo(before!.height, 0);
    expect(await frames).not.toContain(false);
    const text = "这是最终回答。";
    const at = Date.now();
    emit({
      type: "done",
      text,
      at,
      userId: 0,
      replyId: 1,
      messages: [
        { i: 0, kind: "user", text: "验证回复衔接", at },
        { i: 1, kind: "mira", text, at },
      ],
    });
    emit(null);
    await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
    expect(await page.pageErrors()).toEqual([]);
  });
}
