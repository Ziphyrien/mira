import { describe, it, expect } from "vite-plus/test";
import { createHost, defineFacet, local } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension } from "@earendil-works/pi-durable";
import { Extensions } from "./api";
import { ExtensionRegistry } from "./registry";

const DummyFacet = local("test.dummy.facet", { version: 1, input: Type.Object({}) });

describe("ExtensionRegistry with real Chord contributions", () => {
  it("captures phase snapshots, orders extensions, and atomically publishes updates", async () => {
    const extA = defineExtension({ name: "ext-a" });
    const extB = defineExtension({ name: "ext-b" });
    const extC = defineExtension({ name: "ext-c" });
    const extD = defineExtension({ name: "ext-d" });

    const facetName = "test.same.facet";

    const facetV1 = {
      name: facetName,
      ...defineFacet((api) =>
        api.serve(
          DummyFacet,
          (_input, _principal, self) => {
            self.register(Extensions, {
              "key-b": { order: 20, extension: extB },
              "key-a": { order: 10, extension: extA },
            });
            return {};
          },
          { lifetime: "host" },
        ),
      ),
    };

    const host = createHost({ name: "test.registry.host", self: null });
    await host.load([facetV1]);

    const view = host.registry(Extensions);
    const registry = new ExtensionRegistry(view);

    try {
      const initialSnapshot = registry.snapshot();
      const initialNames = initialSnapshot.installed().map((e) => e.name);
      expect(initialNames).toEqual(["ext-a", "ext-b"]);
      const initialTasks = initialSnapshot.tasks();

      let notificationCount = 0;
      const unsub = registry.subscribe(() => {
        notificationCount++;
      });

      // Replace real SAME NAMED facet via host.reload with entire two contributions replaced
      const facetV2 = {
        name: facetName,
        ...defineFacet((api) =>
          api.serve(
            DummyFacet,
            (_input, _principal, self) => {
              self.register(Extensions, {
                "key-d": { order: 5, extension: extD },
                "key-c": { order: 15, extension: extC },
              });
              return {};
            },
            { lifetime: "host" },
          ),
        ),
      };

      await host.reload([facetV2]);

      // Exactly one notification on complete reload
      expect(notificationCount).toBe(1);

      // Old phase snapshot remains unchanged
      expect(initialSnapshot.installed().map((e) => e.name)).toEqual(["ext-a", "ext-b"]);

      // Updated snapshot contains complete new sorted list
      const updatedSnapshot = registry.snapshot();
      expect(updatedSnapshot).not.toBe(initialSnapshot);
      expect(updatedSnapshot.installed().map((e) => e.name)).toEqual(["ext-d", "ext-c"]);

      // Built-in tasks retained
      expect(updatedSnapshot.tasks()).toEqual(initialTasks);

      // Refuse factory failure reload and snapshot stays identical
      const failingFacet = {
        name: facetName,
        ...defineFacet((api) =>
          api.serve(
            DummyFacet,
            () => {
              throw new Error("Factory failure on reload");
            },
            { lifetime: "host" },
          ),
        ),
      };

      await expect(host.reload([failingFacet])).rejects.toThrow("Factory failure on reload");
      expect(registry.snapshot()).toBe(updatedSnapshot);
      expect(
        registry
          .snapshot()
          .installed()
          .map((e) => e.name),
      ).toEqual(["ext-d", "ext-c"]);

      // Refuse duplicate facet reload and snapshot stays identical
      await expect(host.reload([facetV2, facetV2])).rejects.toThrow();
      expect(registry.snapshot()).toBe(updatedSnapshot);

      unsub();
    } finally {
      registry.close();
      await host.close();
    }
  });
});
