import { createSerializedMarkdownParser, type ComarkPlugin, type Node } from "comark";
import math from "comark/plugins/math";
import mermaid from "comark/plugins/mermaid";
import { markdownOptions } from "#lib/shared/markdown.js";

function attachCodeSource(nodes: readonly Node[]) {
  for (const node of nodes) {
    if (typeof node === "string") continue;
    const [tag, attributes, ...children] = node;
    if (tag === "pre") {
      const code = children[0];
      if (Array.isArray(code) && code[0] === "code") {
        attributes.source = code
          .slice(2)
          .filter((part) => typeof part === "string")
          .join("");
      }
    } else {
      attachCodeSource(children);
    }
  }
}

const codeSource: ComarkPlugin = {
  name: "code-source",
  post(state) {
    attachCodeSource(state.tree.nodes);
  },
};

/** Each visible reply owns its incremental parser and stable-node cache. */
export function createReplyParser() {
  return createSerializedMarkdownParser({
    ...markdownOptions,
    plugins: [...markdownOptions.plugins, math(), mermaid(), codeSource],
  });
}
