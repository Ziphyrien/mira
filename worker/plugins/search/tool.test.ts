import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { tavilySearchTool } from "./tool";
import type { SearchActivity } from "../../../src/lib/contracts";
import { bytes } from "../../../src/lib/shared/text";
afterEach(() => vi.unstubAllGlobals());
const originalURL =
  "https://www.threads.com/@meta.ai/post/DY84dGDj9Pt/" +
  encodeURIComponent("毛臘肉是網路用語".repeat(50));
const otherURL = "https://example.com/other";
const results = [originalURL, otherURL].map((url) => ({
  url,
  title: "来源标题",
  content: "正文摘要。".repeat(500),
}));

describe("search source identities", () => {
  it("returns stable IDs for repeated and reordered sources without asking the model to copy URLs", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () =>
      Response.json({ results: calls++ ? [...results].reverse() : results }),
    );
    const activities: SearchActivity[] = [];
    const tool = tavilySearchTool(
      async () => "test-key",
      (activity) => activities.push(activity),
    );
    async function search(taskId: number) {
      const api: Pick<Parameters<typeof tool.execute>[1], "taskId" | "details"> = {
        taskId: taskId as Parameters<typeof tool.execute>[1]["taskId"],
        details: async () => {},
      };
      return tool.execute(
        { query: "来源身份" },
        api as Parameters<typeof tool.execute>[1],
        {} as Parameters<typeof tool.execute>[2],
      );
    }
    const first = await search(1),
      second = await search(2);
    const a = first.details as SearchActivity,
      b = second.details as SearchActivity;
    expect(a.sources).toHaveLength(2);
    for (const source of a.sources) {
      expect(source.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
      expect(b.sources.find((item) => item.url === source.url)?.id).toBe(source.id);
      const output =
        first.output
          ?.filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("") ?? "";
      expect(output).toContain(`[](cite:${source.id})`);
      expect(output).not.toMatch(/\[\d+\]\(cite:/);
      expect(output).not.toContain(source.url);
      expect(bytes(output)).toBeLessThanOrEqual(4000);
    }
    expect(new Set(a.sources.map((source) => source.id)).size).toBe(2);
    expect(a.sources[0].url).toBe(originalURL);
    expect(activities.filter((activity) => activity.status === "done").at(-1)?.sources).toEqual(
      b.sources,
    );
  });
});
