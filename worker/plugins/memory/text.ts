const CAP = 30_000;
function end(text: string, at: number): number {
  if (text.length - at <= CAP) return text.length;
  const newline = text.lastIndexOf("\n", at + CAP - 1);
  const lowSurrogate = text.charCodeAt(at + CAP) >> 10 === 55;
  return newline >= at ? newline + 1 : at + CAP - Number(lowSurrogate);
}
export function pages(text: string): string[] {
  const out: string[] = [];
  let at = 0;
  do {
    const next = end(text, at);
    out.push(text.slice(at, next));
    at = next;
  } while (at < text.length);
  return out;
}
export function page(text: string, at: number): string {
  const next = end(text, at);
  return (
    text.slice(at, next) +
    (next < text.length
      ? `\n[characters ${at + 1}-${next} of ${text.length}; go on with at ${next}]`
      : "")
  );
}
export function clipEcho(text: string): string {
  if (text.length <= CAP) return text;
  const half = CAP / 2,
    keep = half - 64;
  return `${text.slice(0, half)}\n[... ${text.length - half - keep} characters cut ...]\n${text.slice(-keep)}`.toWellFormed();
}
