import { describe, expect, it } from "vite-plus/test";
import { autoCloseMarkdown, parseMarkdown, type Node } from "comark";
import { markdownOptions } from "./markdown";
import { speechText } from "./speech";

function countTags(nodes: readonly Node[], tag: string): number {
  return nodes.reduce((count, node) => {
    if (typeof node === "string") return count;
    const [name, , ...children] = node;
    return count + Number(name === tag) + countTags(children, tag);
  }, 0);
}

const cases = [
  ["这是**中文。**后续文字", "strong", "这是中文。后续文字"],
  ["这是**（中文）**后续文字", "strong", "这是（中文）后续文字"],
  ["这是*中文。*后续文字", "em", "这是中文。后续文字"],
  ["这是~~中文。~~后续文字", "del", "这是中文。后续文字"],
  ["**このアスタリスク。**この文のせいで。", "strong", "このアスタリスク。この文のせいで。"],
  ["**이 괄호(parenthesis)**가 있는 문장", "strong", "이 괄호(parenthesis)가 있는 문장"],
] as const;

describe("CJK Markdown", () => {
  it.each([
    ["这是**中文。**后续文字", "这是**中文。**后续文字"],
    ["这是*中文。*后续文字", "这是*中文。*后续文字"],
    ["这是***中文。***后续文字", "这是***中文。***后续文字"],
    ["这是**中文", "这是**中文**"],
    ["这是*中文", "这是*中文*"],
    ["这是***中文", "这是***中文***"],
    ["これは**日本語", "これは**日本語**"],
    ["여기는**한국어", "여기는**한국어**"],
    ["这是**bold", "这是**bold**"],
    ["这是**粗体与*斜体", "这是**粗体与*斜体***"],
    ["`这是**中文`", "`这是**中文`"],
    ["```text\n这是**中文\n```", "```text\n这是**中文\n```"],
    ["这是\\*\\*中文", "这是\\*\\*中文"],
    ["foo**bar", "foo**bar"],
    ["foo_bar_baz", "foo_bar_baz"],
    ["English **bold", "English **bold**"],
  ])("heals emphasis without changing completed or literal content: %s", (input, expected) => {
    expect(autoCloseMarkdown(input, { syntax: false })).toBe(expected);
  });
  it.each(cases)("renders and speaks CJK delimiters: %s", async (source, tag, spoken) => {
    const document = await parseMarkdown(source, markdownOptions);
    expect(countTags(document.nodes, tag)).toBe(1);
    expect(await speechText(source)).toBe(spoken);
  });

  it("does not interpret emphasis in code, escapes, or intraword underscores", async () => {
    for (const source of [
      "`**中文。**后续文字`",
      "~~~md\n**中文。**后续文字\n~~~",
      "\\*\\*中文。\\*\\*后续文字",
      "foo_bar_baz",
      "中文_下划线_中文",
    ]) {
      const document = await parseMarkdown(source, markdownOptions);
      for (const tag of ["strong", "em", "del"]) expect(countTags(document.nodes, tag)).toBe(0);
    }
    const english = await parseMarkdown("English **bold** text", markdownOptions);
    expect(countTags(english.nodes, "strong")).toBe(1);
  });

  it("keeps untrusted HTML as literal text", async () => {
    const source = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    expect((await parseMarkdown(source, markdownOptions)).nodes).toEqual([["p", {}, source]]);
  });

  it("speaks visible CJK text while filtering links, citations, fenced code and hidden reasoning", async () => {
    const source =
      "# 标题\n\n这是**中文。**后续，*（重点）*文字，~~删除。~~保留。[可见标题](https://example.com) [1](https://citation.example)\n\n```js\nUNWANTED_CODE\n```\n\n<think>UNWANTED_THINKING</think>";
    expect(await speechText(source)).toBe(
      "标题\n这是中文。后续，（重点）文字，删除。保留。可见标题",
    );
  });

  it("does not produce speech when only filtered material remains", async () => {
    expect(
      await speechText(
        "https://example.com [1](https://citation.example)\n\n```js\nONLY_CODE\n```\n\n<analysis>HIDDEN</analysis>",
      ),
    ).toBe("");
  });
});
