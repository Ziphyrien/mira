/** Accepts the key with dashes, spaces or lowercase; returns null if it is not a key. */
export function normalizeKey(input: string): string | null {
  const k = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  return /^[0-9A-HJKMNP-TV-Z]{32}$/.test(k) ? k : null;
}
