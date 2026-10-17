export function textBlocks(content: string | readonly { type: string; text?: string }[]): string {
  if (typeof content === "string") return content;
  return content.map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("");
}
export function thinkingBlocks(
  content: readonly { type: string; thinking?: string; redacted?: boolean }[],
): string {
  return content
    .map((b) => (b.type === "thinking" && !b.redacted ? (b.thinking ?? "") : ""))
    .join("")
    .trim();
}
