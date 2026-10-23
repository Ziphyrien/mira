import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";
let server: ViteDevServer, origin: string;
test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    resolve: { alias: { "#lib": fileURLToPath(new URL("../../src/lib/", import.meta.url)) } },
    cacheDir: "node_modules/.cache/research-draft-vite",
    optimizeDeps: { include: ["idb-keyval"], noDiscovery: true, holdUntilCrawlEnd: false },
    server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
    logLevel: "error",
  });
  await server.listen();
  origin = server.resolvedUrls!.local[0];
});
test.afterAll(async () => {
  await server?.close();
});
test.beforeEach(async ({ context, page }) => {
  await context.route(origin, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Research drafts</title>",
    }),
  );
  await page.goto(origin);
});

test("restoration merges untouched fields, preserves edits before reads, and isolates versions and namespaces", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const path = "/src/lib/plugins/research/drafts.ts";
    const { ResearchDraft } = (await import(
      /* @vite-ignore */ path
    )) as typeof import("../../src/lib/plugins/research/drafts");
    const options = {
      scope: "manager:a",
      name: "create",
      context: "v1",
      initial: { topic: "", background: "" },
      restore: () => {},
    };
    const first = new ResearchDraft(options);
    first.update({ topic: "原主题", background: "保留的背景" });
    await first.flush();
    first.dispose();
    let restored;
    const second = new ResearchDraft({ ...options, restore: (value) => (restored = value) });
    second.update({ topic: "正在输入的新主题", background: "" });
    await second.flush();
    second.dispose();
    let persisted;
    const third = new ResearchDraft({ ...options, restore: (value) => (persisted = value) });
    await third.flush();
    third.dispose();
    let otherRestored = false;
    const other = new ResearchDraft({
      ...options,
      scope: "manager:b",
      restore: () => (otherRestored = true),
    });
    await other.flush();
    other.dispose();
    let staleRestored = false;
    const revised = new ResearchDraft({
      ...options,
      context: "v2",
      restore: () => (staleRestored = true),
    });
    await revised.flush();
    revised.dispose();
    return { restored, persisted, otherRestored, staleRestored };
  });
  expect(result).toEqual({
    restored: { topic: "正在输入的新主题", background: "保留的背景" },
    persisted: { topic: "正在输入的新主题", background: "保留的背景" },
    otherRestored: false,
    staleRestored: false,
  });
});

test("clearing a study blocks a stale tab from recreating drafts and preserves another study", async ({
  page,
  context,
}) => {
  const peer = await context.newPage();
  await peer.goto(origin);
  await peer.evaluate(async () => {
    const path = "/src/lib/plugins/research/drafts.ts";
    const { ResearchDraft } = (await import(
      /* @vite-ignore */ path
    )) as typeof import("../../src/lib/plugins/research/drafts");
    const draft = new ResearchDraft({
      scope: "study:a/participant:x",
      name: "answer:q",
      initial: { value: "" },
      restore: () => {},
    });
    draft.update({ value: "撤回前的回答" });
    await draft.flush();
    Object.assign(window, { pendingResearchDraft: draft });
  });
  await page.evaluate(async () => {
    const path = "/src/lib/plugins/research/drafts.ts";
    const { ResearchDraft, clearDrafts } = (await import(
      /* @vite-ignore */ path
    )) as typeof import("../../src/lib/plugins/research/drafts");
    const other = new ResearchDraft({
      scope: "study:b/participant:y",
      name: "answer:q",
      initial: { value: "" },
      restore: () => {},
    });
    other.update({ value: "另一项研究" });
    await other.flush();
    other.dispose();
    await clearDrafts("study:a");
  });
  await peer.evaluate(async () => {
    const draft = (
      window as unknown as {
        pendingResearchDraft: { update(value: unknown): void; flush(): Promise<void> };
      }
    ).pendingResearchDraft;
    draft.update({ value: "旧标签页的晚到写入" });
    await draft.flush();
  });
  const result = await page.evaluate(async () => {
    const path = "/src/lib/plugins/research/drafts.ts";
    const { ResearchDraft } = (await import(
      /* @vite-ignore */ path
    )) as typeof import("../../src/lib/plugins/research/drafts");
    const restored: string[] = [];
    for (const scope of ["study:a/participant:x", "study:b/participant:y"]) {
      const draft = new ResearchDraft({
        scope,
        name: "answer:q",
        initial: { value: "" },
        restore: (value) => restored.push(value.value),
      });
      await draft.flush();
      draft.dispose();
    }
    return restored;
  });
  expect(result).toEqual(["另一项研究"]);
  await peer.close();
});

test("migrates session drafts and leaves existing data intact when IndexedDB reads fail", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const path = "/src/lib/plugins/research/drafts.ts";
    const { ResearchDraft, legacyAnswer } = (await import(
      /* @vite-ignore */ path
    )) as typeof import("../../src/lib/plugins/research/drafts");
    sessionStorage.setItem("mira:research:draft:legacy:q", JSON.stringify("  完整文字\n"));
    const options = {
      scope: "study:a/participant:x",
      name: "answer:q",
      context: "v1",
      initial: { value: "" },
      restore: () => {},
    };
    let migrated;
    const seed = new ResearchDraft({
      ...options,
      legacy: () => legacyAnswer("legacy:q"),
      restore: (value) => (migrated = value.value),
    });
    await seed.flush();
    seed.dispose();
    const legacyGone = sessionStorage.getItem("mira:research:draft:legacy:q") === null;
    const original = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, "get")!;
    IDBObjectStore.prototype.get = function () {
      throw new DOMException("Unavailable", "SecurityError");
    };
    const failed = new ResearchDraft(options);
    failed.update({ value: "无法读取时的新输入" });
    await failed.flush();
    failed.dispose();
    Object.defineProperty(IDBObjectStore.prototype, "get", original);
    let preserved;
    const restored = new ResearchDraft({
      ...options,
      restore: (value) => (preserved = value.value),
    });
    await restored.flush();
    restored.dispose();
    return { migrated, legacyGone, preserved };
  });
  expect(result).toEqual({ migrated: "  完整文字\n", legacyGone: true, preserved: "  完整文字\n" });
});
