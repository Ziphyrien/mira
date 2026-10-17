import { describe, it, expect, vi } from "vite-plus/test";
import {
  AdminController,
  type AdminTransport,
  type SpaceList,
} from "#lib/plugins/admin/controller.js";
import type { SpaceDetail } from "#lib/contracts/index.js";

function createDeferred<T>() {
  let resolve!: (val: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function spaceList(ids: string[]): SpaceList {
  return {
    items: ids.map((id) => ({ id, name: id, created: 1, seen: 1, messages: 0, cost: 0 })),
    total: ids.length,
    messages: 0,
    cost: 0,
  };
}

describe("AdminController", () => {
  it("bounds background requests, prioritizes a selected queued space and continues after a failure", async () => {
    const ids = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];
    const pending = new Map<string, ReturnType<typeof createDeferred<SpaceDetail>>>();
    const reads: string[] = [];
    const detail: SpaceDetail = {
      profile: null,
      stats: { messages: 0, summaries: 0, viewLines: 0, pending: 0 },
      messages: [],
      view: "",
      cost: 0,
    };
    const controller = new AdminController({
      initial: { admin: true },
      transport: async (path) => {
        if (path === "/api/admin/spaces?q=") return spaceList(ids);
        const id = path.split("/").at(-1)!;
        reads.push(id);
        const deferred = createDeferred<SpaceDetail>();
        pending.set(id, deferred);
        return deferred.promise;
      },
    });
    try {
      await controller.initialize();
      expect(controller.snapshot.loading).toBe(false);
      expect(controller.snapshot.list?.total).toBe(7);
      expect(reads).toEqual(["s1", "s2", "s3"]);
      const opening = controller.open("s7");
      expect(reads).toEqual(["s1", "s2", "s3", "s7"]);
      pending.get("s7")!.resolve(detail);
      await opening;
      expect(controller.snapshot.detail?.id).toBe("s7");
      pending.get("s1")!.reject(new Error("暂时不可用"));
      await vi.waitFor(() => expect(pending.has("s4")).toBe(true));
      expect(controller.snapshot.error).toBe("");
      expect(controller.snapshot.detailError).toBe("");
      pending.get("s2")!.resolve(detail);
      pending.get("s3")!.resolve(detail);
      await vi.waitFor(() => expect(pending.has("s6")).toBe(true));
      for (const id of ["s4", "s5", "s6"]) pending.get(id)!.resolve(detail);
      await controller.open("s6");
      expect(reads).toEqual(["s1", "s2", "s3", "s7", "s4", "s5", "s6"]);
    } finally {
      controller.dispose();
    }
  });
  it.each([true, false])(
    "uses SSR authentication %s once, then explicitly refreshes the session",
    async (admin) => {
      const paths: string[] = [];
      const list = { items: [], total: 0, messages: 0, cost: 0 };
      const controller = new AdminController({
        initial: { admin },
        transport: async (path) => {
          paths.push(path);
          if (path === "/api/admin/session") return { admin: false };
          if (path === "/api/admin/spaces?q=") return list;
          throw new Error(`Unexpected request ${path}`);
        },
      });
      try {
        await controller.initialize();
        expect(controller.snapshot.admin).toBe(admin);
        expect(controller.snapshot.list).toEqual(admin ? list : null);
        expect(paths).toEqual(admin ? ["/api/admin/spaces?q="] : []);
        await controller.initialize();
        expect(paths.at(-1)).toBe("/api/admin/session");
        expect(controller.snapshot.admin).toBe(false);
        expect(controller.snapshot.list).toBeNull();
        expect(controller.snapshot.detail).toBeNull();
      } finally {
        controller.dispose();
      }
    },
  );
  it("stale query response cannot overwrite newer query", async () => {
    const d1 = createDeferred<SpaceList>();
    const d2 = createDeferred<SpaceList>();

    const transport: AdminTransport = vi.fn((path: string) => {
      if (path.includes("q=first")) return d1.promise;
      if (path.includes("q=second")) return d2.promise;
      return Promise.reject(new Error(`unexpected path: ${path}`));
    });

    const controller = new AdminController({ transport });

    const p1 = controller.list("first");
    const p2 = controller.list("second");

    expect(controller.snapshot.query).toBe("second");

    // Newer query resolves first
    d2.resolve({
      items: [{ id: "space-2", name: "Two", created: 1, seen: 2, messages: 5, cost: 0.1 }],
      total: 1,
      messages: 5,
      cost: 0.1,
    });
    await p2;

    expect(controller.snapshot.list?.items[0]?.id).toBe("space-2");

    // Stale older query resolves later
    d1.resolve({
      items: [{ id: "space-1", name: "One", created: 1, seen: 1, messages: 1, cost: 0.01 }],
      total: 1,
      messages: 1,
      cost: 0.01,
    });
    await p1;

    // Must remain space-2, older list was fenced out
    expect(controller.snapshot.list?.items[0]?.id).toBe("space-2");
  });

  it("stale detail response cannot overwrite newer space open", async () => {
    const d1 = createDeferred<SpaceDetail>();
    const d2 = createDeferred<SpaceDetail>();

    const transport: AdminTransport = vi.fn((path: string) => {
      if (path.includes("space-1")) return d1.promise;
      if (path.includes("space-2")) return d2.promise;
      return Promise.reject(new Error(`unexpected path: ${path}`));
    });

    const controller = new AdminController({ transport });

    const p1 = controller.open("space-1");
    const p2 = controller.open("space-2");

    // Newer open resolves first
    d2.resolve({
      profile: { name: "Space 2" } as any,
      stats: { messages: 10, summaries: 1, viewLines: 5, pending: 0 },
      messages: [],
      view: "space 2 memory",
      cost: 0.2,
    });
    await p2;

    expect(controller.snapshot.detail?.id).toBe("space-2");
    expect(controller.snapshot.detail?.view).toBe("space 2 memory");

    // Stale older open resolves later
    d1.resolve({
      profile: { name: "Space 1" } as any,
      stats: { messages: 2, summaries: 0, viewLines: 1, pending: 0 },
      messages: [],
      view: "space 1 memory",
      cost: 0.02,
    });
    await p1;

    // Must still be space-2
    expect(controller.snapshot.detail?.id).toBe("space-2");
    expect(controller.snapshot.detail?.view).toBe("space 2 memory");

    // Closing retains the rendered data until another selection replaces it.
    await controller.open(null);
    expect(controller.snapshot.detailId).toBeNull();
    expect(controller.snapshot.detail?.view).toBe("space 2 memory");

    const late = createDeferred<SpaceDetail>();
    vi.mocked(transport).mockReturnValueOnce(late.promise);
    const pending = controller.open("space-3");
    expect(controller.snapshot.detailId).toBe("space-3");
    expect(controller.snapshot.detail).toBeNull();
    await controller.open(null);
    await pending;
    late.resolve({
      profile: null,
      stats: { messages: 0, summaries: 0, viewLines: 0, pending: 0 },
      messages: [],
      view: "late private data",
      cost: 0,
    });
    await late.promise;
    expect(controller.snapshot.detailId).toBeNull();
    expect(controller.snapshot.detail).toBeNull();
    controller.dispose();
  });

  it("disposed controller cannot publish updates or modify snapshot", async () => {
    const d = createDeferred<SpaceList>();
    const transport: AdminTransport = vi.fn(() => d.promise);
    const controller = new AdminController({ transport });

    const received: number[] = [];
    controller.subscribe((s) => received.push(s.revision));

    const p = controller.list("test");
    const revBeforeDispose = controller.snapshot.revision;

    controller.dispose();
    expect(controller.disposed).toBe(true);

    // Resolve deferred transport after dispose
    d.resolve({ items: [], total: 0, messages: 0, cost: 0 });
    await p;

    // Disposed cannot publish
    expect(controller.snapshot.list).toBeNull();
    expect(received.filter((r) => r > revBeforeDispose)).toHaveLength(0);
  });

  it("refreshes expired details and evicts deleted spaces", async () => {
    vi.useFakeTimers();
    let reads = 0;
    let deleted = false;
    const controller = new AdminController({
      initial: { admin: true },
      transport: async (path, init) => {
        if (path === "/api/admin/spaces?q=") return spaceList(deleted ? [] : ["s1"]);
        if (init?.method === "DELETE") {
          deleted = true;
          return {};
        }
        if (deleted) throw new Error("空间已删除");
        reads++;
        return {
          profile: null,
          stats: { messages: reads, summaries: 0, viewLines: 0, pending: 0 },
          messages: [],
          view: "",
          cost: 0,
        };
      },
    });
    try {
      await controller.initialize();
      await controller.open("s1");
      await vi.advanceTimersByTimeAsync(31_000);
      const opening = controller.open("s1");
      expect(controller.snapshot.detail?.stats.messages).toBe(1);
      await opening;
      expect(controller.snapshot.detail?.stats.messages).toBe(2);
      await controller.delete("s1");
      await controller.open("s1");
      expect(controller.snapshot.detail).toBeNull();
      expect(controller.snapshot.detailError).toBe("空间已删除");
    } finally {
      controller.dispose();
      vi.useRealTimers();
    }
  });

  it.each(["logout", "initialize", "login"] as const)(
    "%s clears cached detail and selection",
    async (action) => {
      let deleted = false;
      let detailReads = 0;
      let listReads = 0;
      const pending = createDeferred<SpaceDetail>();
      const speculativeSignals: AbortSignal[] = [];
      const transport: AdminTransport = vi.fn(async (path: string, init?: RequestInit) => {
        if (path === "/api/admin/session" && init?.method === "DELETE") {
          deleted = true;
          return {};
        }
        if (path === "/api/admin/session") return { admin: false };
        if (path === "/api/admin/spaces?q=")
          return spaceList(listReads++ === 0 ? ["s1", "slow1", "slow2", "slow3", "slow4"] : []);
        if (path.startsWith("/api/admin/spaces/slow")) {
          speculativeSignals.push(init!.signal!);
          return pending.promise;
        }
        if (path === "/api/admin/spaces/s1") {
          detailReads++;
          return {
            profile: null,
            stats: { messages: 0, summaries: 0, viewLines: 0, pending: 0 },
            messages: [],
            view: "",
            cost: 0,
          };
        }
        throw new Error(`Unexpected request ${path}`);
      });

      const controller = new AdminController({ transport, initial: { admin: true } });
      await controller.initialize();
      await controller.open("s1");
      expect(controller.snapshot.detail?.id).toBe("s1");
      await controller.open(null);
      await vi.waitFor(() => expect(speculativeSignals).toHaveLength(3));
      await (action === "login" ? controller.login("new-token") : controller[action]());

      expect(deleted).toBe(action === "logout");
      expect(controller.snapshot.admin).toBe(action === "login");
      if (action !== "login") expect(controller.snapshot.list).toBeNull();
      expect(controller.snapshot.detail).toBeNull();
      expect(controller.snapshot.detailId).toBeNull();
      expect(controller.snapshot.detailError).toBe("");
      expect(speculativeSignals.every((signal) => signal.aborted)).toBe(true);
      expect(vi.mocked(transport).mock.calls.some(([path]) => path.endsWith("/slow4"))).toBe(false);
      if (action !== "login") await controller.login("new-token");
      await controller.open("s1");
      expect(detailReads).toBe(2);
      controller.dispose();
    },
  );
});
