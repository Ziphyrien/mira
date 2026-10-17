import { describe, expect, it } from "vite-plus/test";
import { displayKey, newKey, uidOf } from "../server/identity";
import { normalizeKey } from "./identity";
import { bytes, cut } from "./text";

describe("cut", () => {
  it("never splits a multi-byte character and stays within the limit", () => {
    const s = "留存率 31% → 38%🙂";
    for (let limit = 0; limit <= bytes(s); limit++) {
      const c = cut(s, limit);
      expect(bytes(c)).toBeLessThanOrEqual(limit);
      expect(s.startsWith(c)).toBe(true);
      expect(c).not.toMatch(/\uFFFD|[\uD800-\uDBFF]$/);
    }
  });
});

describe("space keys", () => {
  it("round-trip through the displayed form and map to a stable id", async () => {
    const key = newKey();
    expect(normalizeKey(displayKey(key).toLowerCase())).toBe(key);
    expect(await uidOf(key)).toBe(await uidOf(normalizeKey(displayKey(key))!));
    expect(normalizeKey("not-a-key")).toBeNull();
  });
});
