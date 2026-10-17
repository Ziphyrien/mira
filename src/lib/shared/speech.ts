import { parseMarkdown, type Node } from "comark";
import { markdownOptions } from "./markdown";
import { citationId } from "./citations";

const skipped = new Set(["pre", "img", "hr", "script", "style", "think", "analysis"]);
const blocks = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "tr"]);

function nodeText(node: Node): string {
  if (typeof node === "string") return node;
  const [tag, attributes, ...children] = node;
  if (tag === null || skipped.has(tag)) return "";
  if (tag === "br") return "\n";
  const text = children.map(nodeText).join("");
  if (tag === "a") {
    const label = text.trim();
    const href = typeof attributes.href === "string" ? attributes.href : "";
    if (citationId(href) || /^\[?\d+\]?$/.test(label)) return "";
    const suffix = label.match(/[。，！？；：、][\s\S]*/)?.[0] ?? "";
    if (label === href) return suffix;
    if (URL.canParse(href)) {
      const target = new URL(href);
      const candidate = label.includes("://") ? label : `${target.protocol}//${label}`;
      if (URL.canParse(candidate) && new URL(candidate).href === target.href) return suffix;
    }
  }
  if (tag === "td" || tag === "th") return `${text}，`;
  if (blocks.has(tag)) return `${text}\n`;
  return text;
}

/** Parse the full answer before chunking so code/link boundaries cannot leak into speech. */
export async function speechText(markdown: string): Promise<string> {
  const visible = markdown.replace(
    /<(think|analysis|script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,
    "",
  );
  const document = await parseMarkdown(visible, markdownOptions);
  const text = document.nodes
    .map(nodeText)
    .join("")
    .replace(/(?:https?:\/\/|www\.)[^\s<>[\]{}"“”‘’。，！？；：、]+/gi, "")
    .replace(/\[\^?\d+\]/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+(?=[。，！？；：、])/g, "")
    .trim();
  return /[\p{L}\p{N}]/u.test(text) ? text : "";
}
