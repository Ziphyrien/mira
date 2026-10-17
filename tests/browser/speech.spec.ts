import { expect, test } from "@playwright/test";

test("plays and stops from the toolbar, then stays active until buffered speech finishes", async ({
  page,
}) => {
  expect(
    (
      await page.request.post("/api/onboard", {
        data: { name: "播放器验收", focus: [], style: "balanced", timezone: "UTC" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.put("/api/speech/settings", {
        data: { voice: "Mia", autoPlay: false },
      })
    ).status(),
  ).toBe(200);
  await page.addInitScript(() => {
    // The native method is applied to each source as its receiver below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      start.apply(this, args);
      performance.mark("speech-scheduled", { detail: this.buffer?.length ?? 0 });
      this.addEventListener("ended", () => performance.mark("speech-ended"), { once: true });
    };
  });
  await page.goto("/");
  const id = crypto.randomUUID();
  const cancelled: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/speech/cancel"))
      cancelled.push(request.postDataJSON().requestId);
  });
  const send = async (phase: string) => {
    const text = `rpc-speech ${id} ${phase}`;
    await page.getByRole("textbox", { name: "消息", exact: true }).fill(text);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.locator("article").last()).toContainText(text);
    await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0);
  };
  await send("playing");
  const firstResponse = page.waitForResponse((response) => response.url().endsWith("/api/speech"));
  await page.getByRole("button", { name: "播放回复", exact: true }).click();
  const first = await firstResponse;
  expect(first.status()).toBe(200);
  const firstId = first.request().postDataJSON().requestId;
  const stopped = page.waitForResponse((response) => response.url().endsWith("/api/speech/cancel"));
  await page.getByRole("button", { name: "停止播报", exact: true }).click();
  expect((await stopped).status()).toBe(204);
  await expect(page.getByRole("button", { name: "播放回复", exact: true })).toBeEnabled();
  expect(cancelled).toEqual([firstId]);

  await send("after");
  await page.evaluate(() => {
    performance.clearMarks("speech-scheduled");
    performance.clearMarks("speech-ended");
  });
  const nextResponse = page.waitForResponse((response) => response.url().endsWith("/api/speech"));
  await page.getByRole("button", { name: "播放回复", exact: true }).click();
  const next = await nextResponse;
  expect(next.status()).toBe(200);
  await page.waitForFunction(
    () =>
      performance
        .getEntriesByName("speech-scheduled")
        .reduce((total, entry) => total + Number((entry as PerformanceMark).detail), 0) >= 288_000,
  );
  await expect(page.getByRole("button", { name: "停止播报", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "播放回复", exact: true })).toBeEnabled({
    timeout: 20_000,
  });
  expect(cancelled).toEqual([firstId]);
  const audio = await page.evaluate(() => ({
    scheduled: performance.getEntriesByName("speech-scheduled").length,
    ended: performance.getEntriesByName("speech-ended").length,
  }));
  expect(audio.ended).toBe(audio.scheduled);
  expect(await page.pageErrors()).toEqual([]);
});

for (const phase of ["loading", "playing"] as const) {
  test(`streams speech through the account DO and cancels upstream while ${phase}`, async ({
    page,
  }) => {
    const onboard = await page.request.post("/api/onboard", {
      data: { name: "语音 RPC 验收", focus: [], style: "balanced", timezone: "UTC" },
    });
    expect(onboard.status()).toBe(200);
    const settings = await page.request.put("/api/speech/settings", {
      data: { voice: "Mia", autoPlay: false },
    });
    expect(settings.status()).toBe(200);
    await page.goto("/");
    const result = await page.evaluate(async (phase) => {
      const id = crypto.randomUUID();
      const post = (kind: string, signal?: AbortSignal) =>
        fetch("/api/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: kind === phase ? id : crypto.randomUUID(),
            text: `**rpc-speech ${id} ${kind}**`,
          }),
          signal,
        });
      const controller = new AbortController();
      const firstChunk = Promise.withResolvers<number[]>();
      const first = post(phase, controller.signal)
        .then(async (response) => {
          if (response.status !== 200 || !response.body)
            throw new Error(`Speech returned ${response.status}`);
          const reader = response.body.getReader();
          try {
            const chunk = await reader.read();
            if (chunk.value) firstChunk.resolve(Array.from(chunk.value));
            await reader.read();
          } finally {
            await reader.cancel().catch(() => {});
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) throw error;
        });
      const ready = await post("ready");
      if (ready.status !== 200) throw new Error(`Provider readiness failed: ${ready.status}`);
      const readyBytes = new Uint8Array(await ready.arrayBuffer());
      if (readyBytes.length !== 2)
        throw new Error(`Provider readiness returned ${readyBytes.length} audio bytes`);
      const head = phase === "playing" ? await firstChunk.promise : null;
      controller.abort();
      const stopped = await fetch("/api/speech/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: id }),
      });
      if (stopped.status !== 204) throw new Error(`Cancellation returned ${stopped.status}`);
      await first;
      const next = await post("after");
      const bytes = new Uint8Array(await next.arrayBuffer());
      let incorrect = 0;
      for (let index = 0; index < bytes.length; index++) {
        const expected = ((index % 48_000) + Math.floor(index / 48_000) * 31) % 256;
        if (bytes[index] !== expected) incorrect++;
      }
      return {
        status: next.status,
        type: next.headers.get("content-type"),
        head,
        length: bytes.length,
        incorrect,
      };
    }, phase);
    expect(result.status).toBe(200);
    expect(result.type).toBe("audio/pcm;rate=24000;channels=1");
    expect(result.length).toBe(576_000);
    expect(result.incorrect).toBe(0);
    if (phase === "playing") expect(result.head).toEqual([0, 0, 0, 64]);
    expect(await page.pageErrors()).toEqual([]);
  });
}
