import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { PromptRequest, PromptSnapshot } from "../prompts/api";
import { bytes, cut } from "../../../src/lib/shared/text";
import type { SpaceScope } from "../../core/storage";
import { textBlocks } from "../../core/content";
import { NODE } from "./store";
import type { Compact } from "./ports";
import type { CompactionModels } from "../models/api";
import { viewBlocks } from "./view";
const TRIES = 5;
/** Compression owns bounded model requests, feedback and cost accounting, not the conversation coordinator. */
export function createCompactor(
  scope: SpaceScope,
  planPrompt: (request: PromptRequest) => Promise<PromptSnapshot>,
  models: CompactionModels,
  charge: (cost: number) => void,
): Compact {
  const compact: Compact = async (view, task, callerSignal) => {
    const deadline = AbortSignal.timeout(120_000);
    const signal = AbortSignal.any([callerSignal, scope.signal, deadline]);
    // Only controlled metadata goes into the logged error, never provider payloads or user text.
    const failure = (reason: string, attempt: number, stopReason = "not-requested") => {
      let signalCause = "none";
      if (signal.aborted) {
        if (signal.reason === deadline.reason) signalCause = "deadline";
        else if (signal.reason === scope.signal.reason) signalCause = "scope-retired";
        else signalCause = "caller";
      }
      return new Error(
        `Compaction ${reason} (attempt=${attempt}/${TRIES}, stopReason=${stopReason}, signalCause=${signalCause})`,
      );
    };
    const config = await scope.directory.aiConfiguration();
    const model = models.select(config);
    // Capture one plan for the whole compression, including length/format retries.
    const plan = await planPrompt({ purpose: "compaction", models: config });
    const content = [...viewBlocks(view), { type: "text" as const, text: task }];
    const messages: Message[] = [{ role: "user", content, timestamp: Date.now() }];
    let best: string | undefined;
    for (let t = 0; t < TRIES; t++) {
      if (signal.aborted) throw failure("cancelled", t + 1);
      scope.assert();
      let reply: AssistantMessage;
      try {
        reply = await model.complete(
          { systemPrompt: plan.system, tools: plan.tools, messages },
          signal,
          plan,
        );
      } catch {
        throw failure("request failed", t + 1, "unavailable");
      }
      // Retirement fences all writes; ordinary cancellation still accounts received usage.
      scope.assert();
      charge(reply.usage.cost.total);
      if (signal.aborted || !["stop", "length"].includes(reply.stopReason))
        throw failure("request failed", t + 1, reply.stopReason);
      if (reply.content.some((b) => b.type === "toolCall"))
        throw failure("must not call tools", t + 1, reply.stopReason);
      const line = textBlocks(reply.content).trim();
      let feedback: string;
      if (!line) {
        feedback =
          "Empty summary: write a non-empty summary of the same <input>, in one unnumbered line of at most 512 bytes. Output only the summary.";
      } else if (/^\d+\+\d+\|/.test(line) || /[\r\n]/.test(line)) {
        feedback =
          "Invalid summary format: rewrite the same <input> as one unnumbered line of at most 512 bytes, without an id+n| head or any line breaks. Output only the summary.";
      } else {
        if (best === undefined || bytes(line) < bytes(best)) best = line;
        if (bytes(line) <= NODE) return line;
        feedback = `Too long: your last line for this <input> was ${bytes(line)} bytes,
over the 512-byte limit. Write the whole line again, cutting just
enough of the least valuable items to fit before this cut:
${cut(line, NODE)}| ← LIMIT`;
      }
      if (t === TRIES - 1) {
        if (best !== undefined) return best;
        throw failure("has no non-empty, unnumbered summary line", t + 1, reply.stopReason);
      }
      messages[0] = {
        role: "user",
        content: [...content, { type: "text", text: feedback }],
        timestamp: Date.now(),
      };
    }
    throw failure("exhausted attempts", TRIES);
  };
  return compact;
}
