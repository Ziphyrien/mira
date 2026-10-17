import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Space } from "./space";
import { openSpace } from "./core/space";
import { openDirectory } from "./core/directory";
import { createTestScopePlatform } from "./testing/node-sqlite";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      protected ctx: DurableObjectState,
      protected env: Env,
    ) {}
  },
}));
vi.mock("./core/space", () => ({ openSpace: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const platform = createTestScopePlatform(),
    indexPlatform = createTestScopePlatform();
  const directory = await openDirectory(indexPlatform.storage.sql);
  let alarm: number | Date | null = null;
  const setAlarm = vi.fn(async (time: number | Date) => {
    alarm = time;
  });
  const storage = {
    ...platform.storage,
    setAlarm,
    transaction: <T>(
      callback: (transaction: Pick<DurableObjectTransaction, "setAlarm">) => Promise<T>,
    ) => platform.storage.transaction(() => callback({ setAlarm })),
    deleteAlarm: vi.fn(async () => {
      alarm = null;
    }),
    deleteAll: vi.fn(async () => {
      // Real SQLite deletion, with the atomic all-or-nothing contract of DO deleteAll.
      platform.storage.transactionSync(() => {
        const tables = platform.storage.sql
          .exec<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
          )
          .toArray();
        for (const { name } of tables)
          platform.db.exec(`DROP TABLE "${name.replaceAll('"', '""')}"`);
      });
      alarm = null;
    }),
  };
  const remove = vi.fn(async (id: string) => {
    await directory.index.remove(id);
  });
  const port = {
    aiConfiguration: () => directory.models.configuration(null),
    chatModel: () => directory.models.chatModel(null),
    touch: (row: Parameters<typeof directory.index.touch>[0]) => directory.index.touch(row),
    remove,
  };
  const state = {
    storage,
    waitUntil: (work: Promise<unknown>) => platform.waitUntil(work),
  } as unknown as DurableObjectState;
  const env = { DIRECTORY: { idFromName: () => "main", get: () => port } } as unknown as Env;
  const actual = await vi.importActual<typeof import("./core/space")>("./core/space");
  vi.mocked(openSpace).mockImplementation(actual.openSpace);
  const instance = () => new Space(state, env);
  return {
    platform,
    indexPlatform,
    directory,
    storage,
    remove,
    instance,
    actual,
    alarm: () => alarm,
  };
}
const profile = { name: "Wipe owner", focus: [], style: "brief", timezone: "UTC" };

describe("Space platform lifecycle", () => {
  it("restores a backup atomically with views, image pixels and citations while retaining account and costs", async () => {
    const f = await fixture(),
      space = f.instance();
    try {
      await space.onboard("restore-user", profile);
      f.platform.storage.sql.exec("INSERT INTO mira_kv (k, v) VALUES ('memory-cost', '42')");
      const imageId = "image-1";
      const data = Buffer.from([
        255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 217,
      ]).toString("base64");
      const backup = {
        version: 2,
        messages: [
          {
            id: 0,
            kind: "user",
            text: "看这张图片",
            date: "2026-01-01T00:00:00.000Z",
            images: [imageId],
          },
          {
            id: 1,
            kind: "mira",
            text: "来源[](cite:source-a)",
            date: "2026-01-01T00:01:00.000Z",
            reply: {
              replyTo: 0,
              searches: [
                {
                  id: "search-a",
                  query: "问题",
                  status: "done",
                  sources: [
                    { id: "source-a", title: "原文", url: "https://example.com", excerpt: "内容" },
                  ],
                },
              ],
            },
          },
          { id: 2, kind: "user", text: "下一步", date: "2026-01-01T00:02:00.000Z" },
        ],
        summaries: [
          { id: 0, n: 1, text: "user: 图片" },
          { id: 1, n: 1, text: "mira: 来源" },
          { id: 0, n: 2, text: "图片与来源" },
          { id: 2, n: 1, text: "user: 下一步" },
        ],
        images: { [imageId]: { data, userId: 0 } },
        view: {
          parts: [
            { id: 0, n: 2 },
            { id: 2, n: 1 },
          ],
          seen: [
            { id: 0, n: 2 },
            { id: 2, n: 1 },
          ],
          batch: false,
          seenBatch: false,
        },
        sources: [
          { source: "input:first", id: 0 },
          { source: "entry:old", id: 1 },
          { source: "input:last", id: 2 },
        ],
      };
      const before = await new Response(await space.memoryExport()).json();
      expect(
        await space.memoryImport({ ...backup, messages: [{ ...backup.messages[0], id: 9 }] }),
      ).toMatchObject({ ok: false, status: 400 });
      expect(
        await space.memoryImport({
          ...backup,
          images: { [imageId]: { data: "invalid", userId: 0 } },
        }),
      ).toMatchObject({ ok: false, status: 400 });
      expect(await new Response(await space.memoryExport()).json()).toEqual(before);
      expect(await space.memoryImport(backup)).toEqual({ ok: true, messages: 3 });
      const exported = (await new Response(await space.memoryExport()).json()) as typeof backup;
      expect(exported.messages.map((m) => [m.id, m.kind, m.text])).toEqual(
        backup.messages.map((m) => [m.id, m.kind, m.text]),
      );
      expect(exported.view).toEqual(backup.view);
      expect(exported.images).toEqual(backup.images);
      expect(exported.messages[1].reply).toEqual(backup.messages[1].reply);
      const current = await space.state("restore-user");
      expect(current.profile?.name).toBe(profile.name);
      expect(current.messages).toHaveLength(3);
      expect(
        f.platform.storage.sql.exec("SELECT v FROM mira_kv WHERE k = 'memory-cost'").one(),
      ).toEqual({ v: "42" });
      f.platform.db.exec(
        "CREATE TRIGGER reject_restore BEFORE INSERT ON mira_memory_log BEGIN SELECT RAISE(ABORT, 'reject restore'); END",
      );
      expect(await space.memoryImport(backup)).toMatchObject({ ok: false, status: 500 });
      expect(await new Response(await space.memoryExport()).json()).toEqual(exported);
      f.platform.db.exec("DROP TRIGGER reject_restore");
      expect(await space.memoryImport(exported)).toEqual({ ok: true, messages: 3 });
      expect((await space.state("restore-user")).messages).toHaveLength(3);
      expect(
        await space.memoryImport({
          version: 1,
          messages: backup.messages,
          summaries: backup.summaries,
          images: { [imageId]: data },
        }),
      ).toEqual({ ok: true, messages: 3 });
      expect((await space.state("restore-user")).messages.map((m) => m.text)).toEqual(
        backup.messages.map((m) => m.text),
      );
      expect(Buffer.from((await space.image(imageId))!).toString("base64")).toBe(data);
      await space.wipe();
    } finally {
      f.platform.db.close();
      f.indexPlatform.db.close();
    }
  }, 15000);
  it("queues concurrent wipes behind fatal cleanup and fences ready and cancellation through the changed gate", async () => {
    const f = await fixture();
    const cleanup = Promise.withResolvers<void>();
    let fatal!: () => void;
    vi.mocked(openSpace).mockImplementation(async (scope, failed) => {
      const runtime = await f.actual.openSpace(scope, failed);
      fatal = () => {
        scope.retire();
        failed(cleanup.promise.then(() => runtime.close()));
      };
      return runtime;
    });
    const space = f.instance();
    try {
      await space.onboard("wipe-user", profile);
      expect(await f.directory.index.has("wipe-user")).toBe(true);
      fatal();
      const ready = space.speechPreferences();
      const first = space.wipe(),
        second = space.wipe();
      expect(second).toBe(first);
      const stop = space.stop("cancel-during-wipe").catch((error: unknown) => error);
      expect(f.storage.deleteAll).not.toHaveBeenCalled();
      cleanup.resolve();
      await Promise.all([first, second]);
      expect(await ready).toBeNull();
      expect(await stop).toBeInstanceOf(Error);
      expect(f.storage.deleteAll).toHaveBeenCalledTimes(1);
      expect(await f.directory.index.has("wipe-user")).toBe(false);
      expect((await f.directory.index.list({ query: "", offset: 0 })).items).toEqual([]);
      expect(f.platform.db.prepare("SELECT * FROM mira_memory_log").all()).toEqual([]);
      expect(f.platform.db.prepare("SELECT v FROM mira_kv WHERE k = 'uid'").all()).toEqual([]);
      expect(
        f.platform.db
          .prepare("SELECT v FROM mira_kv WHERE k = 'cancelled-request:cancel-during-wipe'")
          .get(),
      ).toMatchObject({ v: "1" });
      await space.wipe();
    } finally {
      cleanup.resolve();
      f.platform.db.close();
      f.indexPlatform.db.close();
    }
  });

  it.each(["directory", "local"] as const)(
    "retries a %s wipe failure from durable intent after reopening without authenticated access",
    async (failure) => {
      const f = await fixture();
      const space = f.instance();
      try {
        await space.onboard("wipe-user", profile);
        const original = f.platform.db.prepare("SELECT * FROM mira_memory_log").all();
        // Prior maintenance alarms must not mask a missing wipe retry wakeup.
        await f.storage.deleteAlarm();
        if (failure === "directory")
          f.remove.mockRejectedValueOnce(new Error("directory unavailable"));
        else f.storage.deleteAll.mockRejectedValueOnce(new Error("local erase unavailable"));
        await expect(space.wipe()).rejects.toThrow("unavailable");
        expect(f.platform.db.prepare("SELECT * FROM mira_memory_log").all()).toEqual(original);
        expect(f.platform.db.prepare("SELECT v FROM mira_kv WHERE k = 'uid'").get()).toMatchObject({
          v: "wipe-user",
        });
        expect(
          f.platform.db.prepare("SELECT v FROM mira_kv WHERE k = 'wipe-intent'").get(),
        ).toMatchObject({ v: "wipe-user" });
        expect(f.alarm()).not.toBeNull();
        expect(await f.directory.index.has("wipe-user")).toBe(failure === "directory");
        const opens = vi.mocked(openSpace).mock.calls.length;
        // Alarm delivery needs no Directory membership and must not open a model runtime.
        await f.instance().alarm();
        expect(vi.mocked(openSpace).mock.calls).toHaveLength(opens);
        expect(await f.directory.index.has("wipe-user")).toBe(false);
        expect(await f.directory.index.list({ query: "", offset: 0 })).toMatchObject({
          items: [],
          total: 0,
          cost: 0,
          messages: 0,
        });
        expect(f.platform.db.prepare("SELECT * FROM mira_kv").all()).toEqual([]);
        expect(
          f.platform.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all(),
        ).toEqual([{ name: "mira_kv" }]);
        expect(f.alarm()).toBeNull();
      } finally {
        f.platform.db.close();
        f.indexPlatform.db.close();
      }
    },
  );
});
