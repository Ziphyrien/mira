export type Part = { l: number; i: number };
type Summary = { text: string; size: number };
type ReadNode = (part: Part) => Summary | undefined;
export const start = (p: Part) => p.i * 2 ** p.l;
export const end = (p: Part) => (p.i + 1) * 2 ** p.l;
export const flat = (text: string) => text.replace(/\s*\n\s*/g, " ");

/** Unii 1.0.138 Memory.fit/merge: independent views, body bytes, batch commits. */
export function fitView(
  previous: readonly Part[],
  batch: boolean,
  frontier: number,
  high: number,
  admission: boolean,
  read: ReadNode,
): { parts: Part[]; batch: boolean } {
  const cache = new Map<string, Summary | undefined>();
  const node = (p: Part) => {
    const key = `${p.l}:${p.i}`;
    if (!cache.has(key)) cache.set(key, read(p));
    return cache.get(key);
  };
  const size = (p: Part) => node(p)?.size ?? 0;
  const parts = previous.filter((p) => end(p) <= frontier);
  for (let i = parts.length ? end(parts[parts.length - 1]) : 0; i < frontier; i++)
    parts.push({ l: 0, i });
  const total = parts.reduce((n, p) => n + size(p), 0);
  if (!(total > high || (admission && batch))) return { parts, batch };

  const low = high / 2;
  const work: (Part | null)[] = [...parts];
  const next = work.map((_, k) => k + 1),
    prev = work.map((_, k) => k - 1);
  type Pair = { d: number; k: number; a: Part; b: Part };
  const heap: Pair[] = [];
  const above = (a: Pair, b: Pair) => a.d > b.d || (a.d === b.d && a.k < b.k);
  const swap = (a: number, b: number) => {
    [heap[a], heap[b]] = [heap[b], heap[a]];
  };
  const offer = (k: number) => {
    const a = work[k],
      b = work[next[k]];
    if (
      k < 0 ||
      !a ||
      !b ||
      a.i % 2 !== 0 ||
      a.l !== b.l ||
      b.i !== a.i + 1 ||
      !node({ l: a.l + 1, i: a.i / 2 })
    )
      return;
    heap.push({ d: (frontier + 1) / 2 ** a.l - a.i, k, a, b });
    for (let x = heap.length - 1; x > 0;) {
      const parent = (x - 1) >> 1;
      if (!above(heap[x], heap[parent])) break;
      swap(x, parent);
      x = parent;
    }
  };
  const take = () => {
    const top = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let x = 0; ;) {
        let best = x;
        for (const child of [2 * x + 1, 2 * x + 2])
          if (child < heap.length && above(heap[child], heap[best])) best = child;
        if (best === x) break;
        swap(x, best);
        x = best;
      }
    }
    return top;
  };
  let mergedSize = total;
  work.forEach((_, k) => offer(k));
  while (heap.length && mergedSize > low) {
    const { k, a, b } = take(),
      j = next[k];
    if (work[k] !== a || work[j] !== b) continue;
    const up = { l: a.l + 1, i: a.i / 2 };
    mergedSize += size(up) - size(a) - size(b);
    [work[k], work[j]] = [up, null];
    next[k] = next[j];
    prev[next[j]] = k;
    offer(prev[k]);
    offer(k);
  }
  if (admission || mergedSize <= Math.max(low, total - high))
    return { parts: work.filter((p): p is Part => p !== null), batch: mergedSize > low };
  return { parts, batch: total > low };
}

export function renderView(parts: readonly Part[], read: ReadNode): string {
  return `<chat>\n${parts
    .flatMap((p) => {
      const node = read(p);
      return node ? [`${start(p)}+${2 ** p.l}|${flat(node.text)}\n`] : [];
    })
    .join("")}</chat>\n`;
}

/** Four-line blocks preserve the stable prefix while the last partial block grows. */
export function viewBlocks(view: string): { type: "text"; text: string }[] {
  if (!view.startsWith("<chat>\n")) return [{ type: "text", text: view }];
  const close = view.lastIndexOf("</chat>\n");
  if (close < 0) return [{ type: "text", text: view }];
  const lines = view.slice(7, close).split("\n");
  if (lines.at(-1) === "") lines.pop();
  const blocks = [{ type: "text" as const, text: "<chat>\n" }];
  let k = 0;
  for (; k + 4 <= lines.length; k += 4)
    blocks.push({ type: "text", text: lines.slice(k, k + 4).join("\n") + "\n" });
  blocks.push({
    type: "text",
    text:
      lines
        .slice(k)
        .map((line) => line + "\n")
        .join("") + view.slice(close),
  });
  return blocks;
}
