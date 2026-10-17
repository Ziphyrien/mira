import { defineTool } from "@earendil-works/pi-durable";
import { SEARCH_TOOL } from "./prompt";
import { z } from "zod";
import type { SearchActivity, SearchSource } from "../../../src/lib/contracts";
import { bytes, cut } from "../../../src/lib/shared/text";

const ResponseData = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullish(),
      content: z.string().nullish(),
      favicon: z.string().nullish(),
    }),
  ),
});
async function readResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Empty search response");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let size = 0,
    body = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) {
        await reader.cancel();
        throw new Error("Search response too large");
      }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export function tavilySearchTool(
  loadKey: () => Promise<string | undefined>,
  report: (activity: SearchActivity) => void,
) {
  return defineTool({
    ...SEARCH_TOOL,
    replay: "safe",
    async execute(args, api, context) {
      const initial: SearchActivity = {
        id: String(api.taskId),
        query: args.query.trim(),
        status: "running",
        sources: [],
      };
      report(initial);
      await api.details(initial, context);
      const finish = (output: string, sources: SearchSource[] = [], error?: string) => {
        const details: SearchActivity = {
          ...initial,
          status: error ? "error" : "done",
          sources,
          ...(error ? { error } : {}),
        };
        report(details);
        return {
          output: [{ type: "text" as const, text: output }],
          details,
          ...(error ? { isError: true } : {}),
        };
      };
      const timeout = AbortSignal.timeout(12_000);
      const signal = context.abortSignal
        ? AbortSignal.any([context.abortSignal, timeout])
        : timeout;
      try {
        const apiKey = await loadKey();
        if (!apiKey) return finish("Tavily 未配置。", [], "请在管理员设置中配置 Tavily API Key。");
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          signal,
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            query: initial.query,
            search_depth: "basic",
            max_results: 3,
            include_answer: false,
            include_raw_content: false,
            include_images: false,
            include_favicon: true,
            auto_parameters: false,
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          const error = `搜索失败（HTTP ${response.status}）。`;
          let hint = "搜索服务暂时不可用，请稍后再试。";
          if (response.status === 429) hint = "搜索请求过于频繁，请稍后再试。";
          else if (response.status === 401) hint = "搜索凭据无效，请在管理员设置中更新。";
          return finish(error, [], hint);
        }
        const { results } = ResponseData.parse(await readResponse(response));
        const seen = new Set<string>(),
          blocks: string[] = [],
          sources: SearchSource[] = [];
        let remaining = 4000;
        for (const result of results) {
          const url = result.url.trim(),
            content = result.content?.replace(/\s+/g, " ").trim();
          if (!URL.canParse(url) || !/^https?:\/\//i.test(url) || !content || seen.has(url))
            continue;
          // Content-addressed IDs survive search reordering, retries and reloads.
          const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
          const id = btoa(String.fromCharCode(...new Uint8Array(hash).subarray(0, 12)))
            .replace(/\+/g, "-")
            .replace(/\//g, "_");
          const domain = new URL(url).hostname;
          const title = cut(result.title?.trim() || domain, 240);
          const header = `[](cite:${id}) ${title} · ${domain}`;
          const separator = blocks.length ? 2 : 0;
          const room = Math.min(1000, remaining - bytes(header) - 1 - separator);
          if (room <= 3) continue;
          const excerpt = bytes(content) <= room ? content : `${cut(content, room - 3)}…`;
          const block = `${header}\n${excerpt}`;
          blocks.push(block);
          seen.add(url);
          remaining -= bytes(block) + separator;
          sources.push({
            id,
            url,
            title,
            excerpt,
            ...(result.favicon &&
            result.favicon.length <= 2048 &&
            URL.canParse(result.favicon) &&
            /^https?:\/\//i.test(result.favicon)
              ? { favicon: result.favicon }
              : {}),
          });
          if (blocks.length === 3) break;
        }
        return finish(blocks.join("\n\n") || "无结果。", sources);
      } catch (cause) {
        if (context.abortSignal?.aborted) {
          report({ ...initial, status: "error", error: "搜索已停止。" });
          throw cause;
        }
        const error = signal.aborted ? "搜索超时。" : "搜索失败。";
        return finish(error, [], error);
      }
    },
  });
}
