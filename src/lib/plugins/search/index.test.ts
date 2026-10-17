import { describe, expect, it } from "vite-plus/test";
import { buildIndex } from "./index.js";

describe("history search index", () => {
  it.each(["习", "学习", "𠮷"])("finds Han query %s through the real index", (query) => {
    const find = buildIndex([
      { i: 1, kind: "user", text: "学习𠮷", at: 1 },
      { i: 2, kind: "user", text: "无关内容", at: 2 },
    ]);
    expect(find(query).map((row) => row.i)).toEqual([1]);
  });
});
