import { describe, expect, it } from "vite-plus/test";
import { parseMarkdown } from "comark";
import { citationsFor } from "#lib/ui/citations.js";
import { markdownOptions } from "#lib/shared/markdown.js";
import { speechText } from "#lib/shared/speech.js";
import type { SearchActivity } from "#lib/contracts/index.js";
const originalURL =
  "https://www.threads.com/@meta.ai/post/DY84dGDj9Pt/" +
  encodeURIComponent("毛臘肉是網路用語".repeat(50));
const otherURL = "https://example.com/other";

const sourceA = {
  id: "abcdefghijklmnop",
  url: originalURL,
  title: "Threads 原始来源",
  excerpt: "原始摘录",
};
const sourceB = { id: "qrstuvwxyzABCDEF", url: otherURL, title: "另一来源", excerpt: "另一摘录" };
const searches: SearchActivity[] = [
  { id: "search-1", query: "", status: "done", sources: [sourceA, sourceB] },
];
async function references(text: string, activities = searches) {
  return citationsFor((await parseMarkdown(text, markdownOptions)).nodes, activities);
}

describe("ID citations", () => {
  it.each(["", "9"])("maps citation labels %j to system numbering in first-citation order and deduplicates repeated searches", async (label) => {
    const cited = await references(
      `[${label}](cite:${sourceB.id}) 这是**中文。**后续[${label}](cite:${sourceA.id}) [${label}](cite:${sourceB.id})`,
      [...searches, { ...searches[0], id: "search-2", sources: [sourceB] }],
    );
    expect(cited).toEqual([
      { ...sourceB, number: 1 },
      { ...sourceA, number: 2 },
    ]);
    expect(cited[1].url).toBe(originalURL);
  });

  it.each([
    "`[1](cite:abcdefghijklmnop)`",
    "``[1](cite:abcdefghijklmnop)``",
    "~~~~md\n[1](cite:abcdefghijklmnop)\n~~~~",
    "````md\n[1](cite:abcdefghijklmnop)\n````",
    "\\[1\\](cite:abcdefghijklmnop)",
    "[1](cite:zzzzzzzzzzzzzzzz)",
    "[1](cite:short)",
    `[1](${originalURL})`,
  ])(
    "does not invent citations from code, escapes, unknown IDs or ordinary URLs: %s",
    async (text) => {
      expect(await references(text)).toEqual([]);
    },
  );

  it("does not associate an ID with a different reply's missing source metadata", async () => {
    expect(await references(`[1](cite:${sourceA.id})`, [])).toEqual([]);
  });

  it("only resolves a streaming citation once its full source ID is available", async () => {
    const prefix = `[](cite:${sourceA.id}`;
    expect(await references(prefix.slice(0, -1))).toEqual([]);
    expect(await references(prefix + ")")).toEqual([{ ...sourceA, number: 1 }]);
  });

  it("speaks visible CJK text without source identities or citation labels", async () => {
    expect(
      await speechText(`这是**中文。**后续[](cite:${sourceA.id}) [2](cite:${sourceB.id})`),
    ).toBe("这是中文。后续");
  });
});
