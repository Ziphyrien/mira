/** UTF-8 byte length without allocating. */
export function bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (
      c >= 0xd800 &&
      c <= 0xdbff &&
      s.charCodeAt(i + 1) >= 0xdc00 &&
      s.charCodeAt(i + 1) <= 0xdfff
    ) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** The longest prefix of `s` that fits in `limit` UTF-8 bytes, never splitting a character. */
export function cut(s: string, limit: number): string {
  let n = 0;
  let i = 0;
  for (const ch of s) {
    const b = bytes(ch);
    if (n + b > limit) break;
    n += b;
    i += ch.length;
  }
  return s.slice(0, i);
}

/** Words for search: Latin words whole, Han text as single chars and bigrams. */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const m of s.toLowerCase().matchAll(/\p{Script=Han}+|[\p{L}\p{N}]+/gu)) {
    const w = m[0];
    if (/\p{Script=Han}/u.test(w)) {
      const chars = Array.from(w);
      out.push(...chars);
      for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
    } else out.push(w);
  }
  return out;
}
