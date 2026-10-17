import { createHost } from "@earendil-works/chord";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Admin } from "./api.js";
import { adminWeb } from "./web.js";

afterEach(() => vi.unstubAllGlobals());

describe("admin facet shutdown", () => {
  it.each(["login", "initialize"] as const)(
    "aborts work started by %s before host drain without starting queued requests",
    async (operation) => {
      const entered = Promise.withResolvers<void>();
      const response = Promise.withResolvers<Response>();
      const calls: string[] = [];
      const signals: AbortSignal[] = [];
      vi.stubGlobal("fetch", (path: string, init: RequestInit) => {
        calls.push(path);
        if (path === "/api/admin/spaces?q=") {
          return Promise.resolve(
            Response.json({
              items: ["s1", "s2", "s3", "s4"].map((id) => ({
                id,
                name: id,
                created: 1,
                seen: 1,
                messages: 0,
                cost: 0,
              })),
              total: 4,
              messages: 0,
              cost: 0,
            }),
          );
        }
        const signal = init.signal as AbortSignal;
        signals.push(signal);
        signal.addEventListener("abort", () => response.resolve(Response.json({})), { once: true });
        entered.resolve();
        return response.promise;
      });
      const host = createHost({ name: "test.admin.shutdown", self: null });
      await host.load([adminWeb({ initial: { admin: true } })]);
      const admin = await host.get(Admin, {});
      const view = admin.view!;
      const updates: unknown[] = [];
      const unsubscribe = view.subscribe((snapshot) => updates.push(snapshot));
      const pending = (
        operation === "login" ? admin.login("test-token") : admin.initialize(null)
      ).catch(() => {});
      await entered.promise;
      if (operation === "initialize") await pending;
      const count = updates.length;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          host.close(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("host.close did not cancel before drain")),
              500,
            );
          }),
        ]);
        await pending;
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        expect(calls).toEqual(
          operation === "login"
            ? ["/api/admin/session"]
            : [
                "/api/admin/spaces?q=",
                "/api/admin/spaces/s1",
                "/api/admin/spaces/s2",
                "/api/admin/spaces/s3",
              ],
        );
        expect(updates).toHaveLength(count);
      } finally {
        clearTimeout(timer);
        unsubscribe();
        response.resolve(Response.json({}));
        await pending;
        await host.close();
      }
    },
  );
});
