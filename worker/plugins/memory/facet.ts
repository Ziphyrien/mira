import { defineFacet, type Facet } from "@earendil-works/chord";
import type { SpaceScope } from "../../core/storage";
import { ProfileData } from "../profile/api";
import { ConversationStore } from "../conversation/api";
import { ImageStore } from "../images/api";
import { PromptPlans } from "../prompts/api";
import { SessionModels } from "../models/api";
import { UsageLedger } from "../admin/api";
import { createCompactor } from "./compactor";
import { Memory } from "./store";
import { MemoryStore, MemoryQueries } from "./api";
export function memoryFacet(scope: SpaceScope): Facet {
  return {
    name: "mira.memory",
    ...defineFacet(
      (api) => {
        api.serve(MemoryStore, (_input, _principal, self) => {
          const prompts = self.get(PromptPlans, {}),
            models = self.get(SessionModels, {});
          const memoryResource = self.resource("memory", {
            version: 1,
            deps: [prompts, models],
            open: () => {
              const ledger = new UsageLedger(scope.storage.sql);
              return new Memory(
                scope.storage,
                createCompactor(
                  scope,
                  (request) => api.root((ctx) => prompts.create(request, ctx)),
                  models.registry!.compaction,
                  (cost) => ledger.charge(cost),
                ),
                (work) => {
                  scope.background(work, "memory.work");
                  scope.wake();
                },
              );
            },
            close: (memory) => memory.close(),
          });
          return { store: self.expose(memoryResource) };
        });
        api.serve(MemoryQueries, (_input, _principal, self) => {
          const memory = self.get(MemoryStore, {}),
            images = self.get(ImageStore, {}),
            journal = self.get(ConversationStore, {}),
            profile = self.get(ProfileData, {});
          return {
            zoom: ({ id, n = 1, at, page }) => {
              const offset = at ?? (page ?? 0) * 10_000;
              const reference = memory.store!.image(id);
              return {
                text: memory.store!.zoom(id, n, offset),
                ...(n === 1 && offset === 0
                  ? {
                      image: reference
                        ? images.store!.contentById(reference)
                        : images.store!.content(id),
                    }
                  : {}),
              };
            },
            date: async (id, ctx) => {
              const p = await profile.get(null, ctx);
              if (!p) throw new Error("Profile is not configured");
              return memory.store!.date(id, p.timezone);
            },
            tree: ({ id, n }) => memory.store!.tree(id, n),
            lines: () => memory.store!.lines(),
            export: () => {
              const revision = memory.store!.revision;
              const records = (function* () {
                yield* memory.store!.dump(
                  (id) => images.store!.forUser(id)?.id,
                  (id) => journal.store!.metadata([id]).get(id),
                );
                yield* images.store!.dump();
                yield "}";
              })();
              const encoder = new TextEncoder();
              return new ReadableStream<Uint8Array>({
                pull(controller) {
                  try {
                    scope.assert();
                    if (memory.store!.revision !== revision)
                      throw new Error("记忆已更新，请重新导出。");
                    const next = records.next();
                    if (next.done) controller.close();
                    else controller.enqueue(encoder.encode(next.value));
                  } catch (error) {
                    records.return(undefined);
                    controller.error(error);
                  }
                },
                cancel() {
                  records.return(undefined);
                },
              });
            },
          };
        });
      },
      {
        uses: [ProfileData, PromptPlans, SessionModels, MemoryStore, ImageStore, ConversationStore],
      },
    ),
  };
}
