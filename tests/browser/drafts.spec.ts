import { test, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";

// A small browser harness serves production modules; no Workers, build, or source writes.
let server: ViteDevServer;
let origin: string;
const accountA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const accountB = "1123456789ABCDEFGHJKMNPQRSTVWXYZ";

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    resolve: { alias: { "#lib": fileURLToPath(new URL("../../src/lib/", import.meta.url)) } },
    cacheDir: "node_modules/.cache/draft-vite",
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
test.beforeEach(async ({ page }) => {
  await page.route(origin, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Draft storage</title>",
    }),
  );
});

test("reload preserves Blob bytes, normalized identity, and separate returning-account drafts", async ({
  page,
}) => {
  let key = accountA;
  await page.route("**/api/key", (route) => route.fulfill({ json: { key } }));
  await page.goto(origin);
  await page.evaluate(async () => {
    const path = "/src/lib/plugins/drafts/store.ts";
    const { DurableDraft } = await import(/* @vite-ignore */ path);
    const draft = new DurableDraft();
    draft.setText("account A unsent");
    draft.setImage(new Blob([new Uint8Array([1, 3, 5, 7])], { type: "image/jpeg" }));
    await draft.flush();
    // Intentionally omit dispose: simulate reload without application cleanup.
  });
  key = accountB;
  await page.reload();
  expect(
    await page.evaluate(async () => {
      const path = "/src/lib/plugins/drafts/store.ts";
      const { DurableDraft } = await import(/* @vite-ignore */ path);
      const draft = new DurableDraft();
      await draft.flush();
      const empty = draft.snapshot.text === "" && draft.snapshot.image === null;
      draft.setText("account B unsent");
      await draft.dispose();
      return empty;
    }),
  ).toBe(true);
  key = accountA.toLowerCase().match(/.{4}/g)!.join("-");
  await page.reload();
  const restored = await page.evaluate(async () => {
    const path = "/src/lib/plugins/drafts/store.ts";
    const { DurableDraft } = await import(/* @vite-ignore */ path);
    const draft = new DurableDraft();
    await draft.flush();
    const result = {
      text: draft.snapshot.text,
      type: draft.snapshot.image?.type,
      bytes: Array.from(new Uint8Array(await draft.snapshot.image.arrayBuffer())),
    };
    await draft.dispose();
    const idbPath = "/node_modules/idb-keyval/dist/index.js";
    const idb = await import(/* @vite-ignore */ idbPath);
    const records = await idb.entries(idb.createStore("mira-drafts", "drafts"));
    return {
      ...result,
      keys: records.map(([key]: [string, unknown]) => key),
      fields: Object.keys(records[0][1]).sort(),
    };
  });
  expect(restored.text).toBe("account A unsent");
  expect(restored.type).toBe("image/jpeg");
  expect(restored.bytes).toEqual([1, 3, 5, 7]);
  expect(restored.keys).toHaveLength(2);
  expect(restored.keys.every((key: string) => /^[a-f0-9]{64}$/.test(key))).toBe(true);
  expect(restored.fields).toEqual(["image", "text", "version"]);
  key = accountB;
  await page.reload();
  expect(
    await page.evaluate(async () => {
      const path = "/src/lib/plugins/drafts/store.ts";
      const { DurableDraft } = await import(/* @vite-ignore */ path);
      const draft = new DurableDraft();
      await draft.flush();
      return draft.snapshot.text;
    }),
  ).toBe("account B unsent");
});

test("restoration merges untouched fields and delete-all wins over queued and late saves", async ({
  page,
}) => {
  await page.route("**/api/key", (route) => route.fulfill({ json: { key: accountA } }));
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const path = "/src/lib/plugins/drafts/store.ts";
    const { DurableDraft } = await import(/* @vite-ignore */ path);
    const original = new DurableDraft();
    original.setText("old text");
    original.setImage(new Blob(["saved image"], { type: "image/jpeg" }));
    await original.flush();
    await original.dispose();
    const edited = new DurableDraft();
    edited.setText("new text during restore");
    await edited.flush();
    const merged = { text: edited.snapshot.text, image: await edited.snapshot.image.text() };
    for (let i = 0; i < 20; i++) edited.setText(`queued ${i}`);
    const clear = edited.clear();
    edited.setText("late stale callback");
    edited.setImage(new Blob(["late image"]));
    await clear;
    await edited.dispose();
    const reopened = new DurableDraft();
    await reopened.flush();
    const cleared = reopened.snapshot.text === "" && reopened.snapshot.image === null;
    await reopened.dispose();
    return { merged, cleared };
  });
  expect(result).toEqual({
    merged: { text: "new text during restore", image: "saved image" },
    cleared: true,
  });
});

test("a new image preparation fences restoration and its owner revokes only the preview URL", async ({
  page,
}) => {
  await page.route("**/api/key", (route) => route.fulfill({ json: { key: accountA } }));
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const storePath = "/src/lib/plugins/drafts/store.ts";
    const imagePath = "/src/lib/plugins/images/draft.ts";
    const { DurableDraft } = await import(/* @vite-ignore */ storePath);
    const { ImageDraftController } = await import(/* @vite-ignore */ imagePath);
    const original = new DurableDraft();
    original.setImage(new Blob(["old image"], { type: "image/jpeg" }));
    await original.flush();
    await original.dispose();
    const draft = new DurableDraft();
    const prepared = Promise.withResolvers<Blob>();
    const images = new ImageDraftController({
      model: { supportsImages: true },
      drafts: draft,
      preparePort: () => prepared.promise,
    });
    const preparing = images.prepare(new File(["raw"], "new.jpg", { type: "image/jpeg" }));
    await draft.flush();
    const fenced = images.snapshot.blob === null && images.snapshot.preparing;
    prepared.resolve(new Blob(["new prepared image"], { type: "image/jpeg" }));
    await preparing;
    await draft.flush();
    const url = images.snapshot.url;
    const preview = await (await fetch(url)).text();
    images.dispose();
    const revoked = await fetch(url).then(
      () => false,
      () => true,
    );
    await draft.dispose();
    const restored = new DurableDraft();
    const restoredImages = new ImageDraftController({
      model: { supportsImages: true },
      drafts: restored,
    });
    await restored.flush();
    const restoredPreview = await (await fetch(restoredImages.snapshot.url)).text();
    restoredImages.clear();
    await restored.flush();
    restoredImages.dispose();
    await restored.dispose();
    const cleared = new DurableDraft();
    await cleared.flush();
    const empty = cleared.snapshot.image === null;
    await cleared.dispose();
    return { fenced, preview, revoked, restoredPreview, empty };
  });
  expect(result).toEqual({
    fenced: true,
    preview: "new prepared image",
    revoked: true,
    restoredPreview: "new prepared image",
    empty: true,
  });
});

test("a failed restore preserves the saved draft when disposing or editing, while explicit deletion still clears it", async ({
  page,
}) => {
  await page.route("**/api/key", (route) => route.fulfill({ json: { key: accountA } }));
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const path = "/src/lib/plugins/drafts/store.ts";
    const { DurableDraft } = await import(/* @vite-ignore */ path);
    const seed = new DurableDraft();
    seed.setText("saved text");
    seed.setImage(new Blob(["saved image"], { type: "image/jpeg" }));
    await seed.flush();
    await seed.dispose();
    const descriptor = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, "get")!;
    const observed = [];
    for (const edit of [false, true]) {
      IDBObjectStore.prototype.get = () => {
        throw new DOMException("Temporary read failure", "AbortError");
      };
      const failed = new DurableDraft();
      await failed.flush();
      if (edit) failed.setText("changed without restoring the image");
      await failed.dispose();
      Object.defineProperty(IDBObjectStore.prototype, "get", descriptor);
      const reopened = new DurableDraft();
      await reopened.flush();
      observed.push({ text: reopened.snapshot.text, image: await reopened.snapshot.image?.text() });
      await reopened.dispose();
    }
    IDBObjectStore.prototype.get = () => {
      throw new DOMException("Temporary read failure", "AbortError");
    };
    const erased = new DurableDraft();
    await erased.flush();
    await erased.clear();
    await erased.dispose();
    Object.defineProperty(IDBObjectStore.prototype, "get", descriptor);
    const empty = new DurableDraft();
    await empty.flush();
    const cleared = empty.snapshot.text === "" && empty.snapshot.image === null;
    await empty.dispose();
    return { observed, cleared };
  });
  expect(result).toEqual({
    observed: [
      { text: "saved text", image: "saved image" },
      { text: "saved text", image: "saved image" },
    ],
    cleared: true,
  });
});

test("unsupported restored images are removed while their text remains usable", async ({
  page,
}) => {
  await page.route("**/api/key", (route) => route.fulfill({ json: { key: accountA } }));
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const storePath = "/src/lib/plugins/drafts/store.ts";
    const imagePath = "/src/lib/plugins/images/draft.ts";
    const { DurableDraft } = await import(/* @vite-ignore */ storePath);
    const { ImageDraftController } = await import(/* @vite-ignore */ imagePath);
    const seed = new DurableDraft();
    seed.setText("still send this text");
    seed.setImage(new Blob(["old image"], { type: "image/jpeg" }));
    await seed.flush();
    await seed.dispose();
    const draft = new DurableDraft();
    const images = new ImageDraftController({ model: { supportsImages: false }, drafts: draft });
    await draft.flush();
    const state = {
      text: draft.snapshot.text,
      image: images.snapshot.blob === null,
      error: images.snapshot.error,
    };
    images.dispose();
    await draft.dispose();
    const reopened = new DurableDraft();
    await reopened.flush();
    const persisted = { text: reopened.snapshot.text, image: reopened.snapshot.image === null };
    await reopened.dispose();
    return { state, persisted };
  });
  expect(result).toEqual({
    state: {
      text: "still send this text",
      image: true,
      error: "当前日常模型不支持读图，待发送图片已移除。",
    },
    persisted: { text: "still send this text", image: true },
  });
});

test("storage denial leaves edits usable, and disposal aborts pending identity requests", async ({
  page,
}) => {
  await page.route("**/api/key", (route) => route.fulfill({ json: { key: accountA } }));
  await page.goto(origin);
  expect(
    await page.evaluate(async () => {
      const path = "/src/lib/plugins/drafts/store.ts";
      const { DurableDraft } = await import(/* @vite-ignore */ path);
      const descriptor = Object.getOwnPropertyDescriptor(IDBFactory.prototype, "open")!;
      IDBFactory.prototype.open = () => {
        throw new DOMException("Storage denied", "SecurityError");
      };
      const draft = new DurableDraft();
      draft.setText("still usable");
      await draft.flush();
      const text = draft.snapshot.text;
      await draft.clear();
      await draft.dispose();
      Object.defineProperty(IDBFactory.prototype, "open", descriptor);
      let signal: AbortSignal | null | undefined;
      const fetch = window.fetch;
      window.fetch = (_input, init) => {
        signal = init?.signal;
        return new Promise(() => {});
      };
      const pending = new DurableDraft();
      await pending.dispose();
      window.fetch = fetch;
      return { text, aborted: signal?.aborted };
    }),
  ).toEqual({ text: "still usable", aborted: true });
});
