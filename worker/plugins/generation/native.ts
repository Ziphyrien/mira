import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import {
  Harness,
  LiveDoc,
  ProviderDoc,
  watchEvents,
  type EntryId,
  type Cursor,
  type LiveState,
} from "@earendil-works/pi-durable";
import type { Models } from "@earendil-works/pi-ai/models";
import { openDurableObjectSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/cloudflare";
import type { SpaceScope } from "../../core/storage";
import { textBlocks, thinkingBlocks } from "../../core/content";
import type { LogMessage } from "../memory/ports";
import type { ExtensionRegistry } from "./registry";
import type { GenerationPorts } from "./api";
import type { LiveGeneration } from "./ports";
function liveView(live: Readonly<LiveState> | null | undefined): LiveGeneration {
  const content = live?.generation?.message?.content;
  return {
    busy: live?.run !== undefined,
    taskId: live?.run?.taskId,
    ...(content
      ? { message: { text: textBlocks(content), thinking: thinkingBlocks(content) } }
      : {}),
    recalling: (live?.tools ?? []).some(
      (tool) => tool.name !== "tavily_search" && tool.status !== "done",
    ),
  };
}
/** Native Pi identities, contexts, watch handles and scheduler receipts stay inside this adapter. */
export async function openGeneration(
  scope: SpaceScope,
  models: Models,
  registry: ExtensionRegistry,
  failed: () => void,
): Promise<GenerationPorts & { close(): Promise<void> }> {
  let harness: Harness | undefined;
  try {
    const storage = await openDurableObjectSqliteStorage(scope.platform.storage, { prefix: "pi_" });
    scope.assert();
    const engine = (harness = await Harness.open(
      storage,
      {
        models,
        registry,
        onReport: (error) => console.error("pi.durable", error),
        settings: {
          stream: { timeoutMs: 120_000 },
          retry: { maxRetries: 2 },
          compaction: { enabled: false },
          progress: { partialIntervalMs: 400, outputIntervalMs: 1000 },
          contextRetentionMs: 0,
        },
      },
      ctx,
    ));
    const root = await engine.root(ctx);
    const events = await watchEvents(engine, root.id, ctx);
    scope.assert();
    void engine.closed
      .then((end) => {
        if (end.reason === "failed") {
          scope.retire();
          failed();
        }
      })
      .catch((error: unknown) => console.error("generation.close", error));
    return {
      turn: {
        prepare: async ({ model, thinking, sessionId, reset }) => {
          if (reset) {
            await root.reset(undefined, ctx);
            await root.configure({ model, thinkingLevel: thinking }, ctx);
          }
          const provider = await engine.snapshot(ProviderDoc, root.id, ctx);
          if (provider?.sessionId !== sessionId)
            await root.commit(async (tx) => {
              (await tx.doc(ProviderDoc, root.id)).sessionId = sessionId;
            }, ctx);
        },
        submit: async (text, attemptId) => {
          const submission = await root.submit(
            { type: "input", content: text, requestId: attemptId, whenBusy: "reject" },
            ctx,
          );
          return { wait: async () => (await submission.wait(ctx)).status === "done" };
        },
        resume: () => engine.resume(),
        abort: () => root.abort(ctx),
        idle: () => root.waitForIdle(ctx),
        live: async () => liveView(await engine.snapshot(LiveDoc, root.id, ctx)),
        watch: async () => {
          const watch = await engine.watchDoc(LiveDoc, root.id, ctx);
          if (!watch) return undefined;
          const initial = liveView(watch.value);
          let stopped = false;
          return {
            start: (listener) => {
              // Acquisition already buffers revisions. Hydrate before starting that queue.
              void Promise.resolve()
                .then(() => {
                  if (!stopped) return listener(initial);
                })
                .then(() => {
                  if (!stopped) watch.start((live) => listener(liveView(live)));
                })
                .catch(async (error: unknown) => {
                  console.error("generation.watch", error);
                  stopped = true;
                  await watch.stop();
                });
            },
            stop: async () => {
              stopped = true;
              await watch.stop();
            },
          };
        },
        answer: async () => {
          const context = await root.context(ctx);
          const last = context.messages.findLast((message) => message.role === "assistant");
          return {
            text: last ? textBlocks(last.content) : "",
            complete: Boolean(last && ["stop", "length", "toolUse"].includes(last.stopReason)),
            thinking: context.messages
              .flatMap((message) =>
                message.role === "assistant" ? [thinkingBlocks(message.content)] : [],
              )
              .filter(Boolean)
              .join("\n\n"),
          };
        },
      },
      transcript: {
        async *entries(after) {
          let cursor: Cursor | undefined;
          do {
            const page = await root.entries(
              { order: "ascending", ...(after ? { minEntryId: Number(after) as EntryId } : {}) },
              100,
              cursor,
              ctx,
            );
            for (const entry of page.items) {
              if (String(entry.id) === after) continue;
              const rows: LogMessage[] = [];
              for (const message of entry.model ?? []) {
                if (message.role === "assistant") {
                  if (!["stop", "length", "toolUse"].includes(message.stopReason)) continue;
                  let said = "";
                  const flush = () => {
                    if (said) rows.push({ kind: "mira", text: said, date: message.timestamp });
                    said = "";
                  };
                  for (const block of message.content) {
                    if (block.type === "text") said += block.text;
                    else if (block.type === "toolCall") {
                      flush();
                      rows.push({
                        kind: "tool",
                        text: `${block.name} ${JSON.stringify(block.arguments)}`,
                        date: message.timestamp,
                      });
                    }
                  }
                  flush();
                } else if (message.role === "toolResult")
                  rows.push({
                    kind: "echo",
                    text: textBlocks(message.content),
                    date: message.timestamp,
                  });
              }
              yield { id: String(entry.id), rows };
            }
            cursor = page.next;
          } while (cursor);
        },
        start: (listener) =>
          events.start(async (batch) => {
            if (
              batch.some(
                (event) =>
                  event.type === "entry_appended" ||
                  event.type === "message_end" ||
                  event.type === "snapshot",
              )
            )
              await listener();
          }),
        stop: async () => {
          await events.stop();
        },
      },
      usage: {
        cost: async () => {
          const usage = await engine.usage(ctx);
          return Object.values(usage.models).reduce(
            (sum, model) => sum + (model.cost?.total ?? 0),
            0,
          );
        },
      },
      close: async () => {
        try {
          await events.stop();
        } finally {
          try {
            await engine.close(ctx);
          } finally {
            registry.close();
          }
        }
      },
    };
  } catch (error) {
    registry.close();
    await harness?.close(ctx).catch(() => {});
    throw error;
  }
}
