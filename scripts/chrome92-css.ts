import postcss, {
  type AtRule,
  type Container,
  type Declaration,
  type Root,
  type Rule,
} from "postcss";
import { transform, type Targets } from "lightningcss";

/**
 * Chrome 92 compatibility layer, written as an *addition* to the stylesheet.
 *
 * Lightning CSS already lowers values for the `chrome 92` target, but three
 * structural features survive it and fail silently on that engine:
 *
 *  - `@layer` (Chrome 99) is dropped together with its contents.
 *  - `:has()` (Chrome 105) invalidates the whole selector it appears in.
 *  - `dvh` (Chrome 108) makes the declaration invalid.
 *
 * Rewriting the author's CSS would change what current browsers render, so this
 * pass leaves the original rules untouched and appends a second copy wrapped in
 * `@supports not selector(:has(*))`. Engines that understand `:has()` also
 * understand `@layer`, so the guard is true exactly on the engines that need the
 * fallback and false everywhere else: modern output is byte-for-byte unchanged
 * in effect, and the copy costs only download size.
 *
 * Two edits are additive in place, because both are plain declaration pairs
 * whose later half modern engines already prefer:
 *
 *  - `--color-*: oklch(...)` gains an `--color-*-rgb: R G B` triplet next to it,
 *    so source code can write `rgb(var(--color-primary-rgb) / 15%)` where it
 *    needs a translucent theme colour, without hand-maintained constants.
 *  - `height: 100dvh` gains `height: 100vh` before it.
 */

const TARGETS: Targets = { chrome: 92 << 16 };

/** True on engines that need the fallback: no `:has()`, therefore no `@layer`. */
const LEGACY_GUARD = "not selector(:has(*))";

const MODERN_COLOR = /\b(?:oklch|oklab|lab|lch|color-mix)\(/;

/** Any colour form a `--color-*` palette entry can arrive in after lowering. */
const COLOR_VALUE =
  /^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\()/i;
const THEME_MIX = /color-mix\(in (?:oklab|srgb),\s*var\((--color-[a-z0-9-]+)\)\s+([\d.]+%),\s*transparent\)/g;
const DYNAMIC_VIEWPORT = /\b[sld]vh\b/g;

const lowered = new Map<string, string | undefined>();

/** Resolve a colour value the way Chrome 92 would understand it, or undefined. */
function lowerValue(property: string, value: string): string | undefined {
  if (!MODERN_COLOR.test(value)) return value;
  if (value.includes("color-mix(")) return undefined; // not representable without a base colour
  const key = `${property}\u0000${value}`;
  if (lowered.has(key)) return lowered.get(key);
  let result: string | undefined;
  try {
    const output = transform({
      filename: "value.css",
      code: Buffer.from(`a{${property}:${value}}`),
      minify: true,
      targets: TARGETS,
    }).code.toString();
    const parsed = postcss.parse(output);
    parsed.walkDecls((declaration) => {
      // The first matching declaration is the unconditional fallback; anything
      // after it sits inside `@supports (color: lab(...))` and is lost on 92.
      if (result === undefined && declaration.prop === property) result = declaration.value;
    });
  } catch {
    result = undefined;
  }
  lowered.set(key, result);
  return result;
}

/** `oklch(55% 0.17 262)` becomes `54 107 211`, the sRGB channels Chrome 92 sees. */
function channels(value: string): string | undefined {
  // Lightning CSS has usually lowered the palette to hex (or hex plus a `lab()`
  // upgrade inside @supports) before this runs, so accept any colour form and
  // let it convert whatever is still in a modern notation.
  const loweredValue = lowerValue("color", value) ?? value;
  const hex = /#([0-9a-f]{6})\b/i.exec(loweredValue)?.[1];
  if (!hex) return undefined;
  return [0, 2, 4]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
    .join(" ");
}

/** Selector lists separate on top-level commas only; split at bracket depth 0. */
function splitSelectors(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let current = "";
  for (const character of selector) {
    if (quote) {
      if (character === quote) quote = undefined;
      current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Add an sRGB triplet beside each theme colour, in the same scope. */
function addRgbTriplets(root: Root): number {
  let added = 0;
  root.walkDecls((declaration) => {
    if (!declaration.prop.startsWith("--color-") || declaration.prop.endsWith("-rgb")) return;
    if (!COLOR_VALUE.test(declaration.value)) return;
    const triplet = channels(declaration.value);
    if (!triplet) return;
    const sibling = declaration.next();
    if (sibling?.type === "decl" && sibling.prop === `${declaration.prop}-rgb`) return;
    declaration.cloneAfter({ prop: `${declaration.prop}-rgb`, value: triplet });
    added += 1;
  });
  return added;
}

/** Keep `100vh` ahead of every `100dvh` so full-height layouts survive. */
function addViewportFallbacks(root: Root): number {
  let added = 0;
  root.walkDecls((declaration) => {
    if (!DYNAMIC_VIEWPORT.test(declaration.value)) return;
    DYNAMIC_VIEWPORT.lastIndex = 0;
    const value = declaration.value.replace(DYNAMIC_VIEWPORT, "vh");
    const previous = declaration.prev();
    if (previous?.type === "decl" && previous.prop === declaration.prop && previous.value === value)
      return;
    declaration.cloneBefore({ value });
    added += 1;
  });
  return added;
}

/** Every `@layer` rule still present, outermost first, for repeat unwrapping. */
function layersIn(root: Root): AtRule[] {
  const found: AtRule[] = [];
  root.walkAtRules("layer", (rule: AtRule) => {
    found.push(rule);
  });
  return found;
}

/** Build the copy that only the guarded block ships to Chrome 92. */
function legacyCopy(root: Root): Root {
  const copy = root.clone();

  // `@layer` disappears whole on 92; unwrap in document order, which is the
  // order the layers were declared in, so the cascade is preserved.
  //
  // Unwrapping cannot be a single walk: moving a layer's children up shifts the
  // walker's position, so nested layers and siblings are skipped. Repeat until
  // no layer remains — the stylesheet has a handful, so this converges quickly.
  for (let remaining = layersIn(copy); remaining.length > 0; remaining = layersIn(copy)) {
    for (const rule of remaining) {
      if (!rule.nodes) {
        rule.remove(); // `@layer a, b;` ordering statement
        continue;
      }
      const parent = rule.parent as Container;
      // Snapshot first: insertBefore detaches the node it moves, and iterating
      // the live child list would skip every other rule.
      const children = [...rule.nodes];
      for (const node of children) parent.insertBefore(rule, node);
      rule.remove();
    }
  }

  // `@supports (color: color-mix(...))` is false on 92, which would hide the
  // very rules the copy exists to provide. Unwrap and resolve them below.
  copy.walkAtRules("supports", (rule: AtRule) => {
    if (!/color-mix\(/.test(rule.params)) return;
    const parent = rule.parent as Container;
    // Same reason as the layer unwrap: iterate a snapshot, not the live list.
    const children = [...(rule.nodes ?? [])];
    for (const node of children) parent.insertBefore(rule, node);
    rule.remove();
  });

  copy.walkRules((rule: Rule) => {
    if (!rule.selector.includes(":has(")) return;
    const kept = splitSelectors(rule.selector).filter((part) => !part.includes(":has("));
    if (kept.length === 0) rule.remove();
    else rule.selector = kept.join(", ");
  });

  copy.walkDecls((declaration: Declaration) => {
    if (declaration.value.includes("color-mix(")) {
      let replaced = false;
      const value = declaration.value.replace(THEME_MIX, (_match, name: string, percent: string) => {
        replaced = true;
        return `rgb(var(${name}-rgb) / ${percent})`;
      });
      if (replaced && !value.includes("color-mix(")) {
        declaration.value = value;
        return;
      }
      // Mixes over `currentColor` cannot be expressed as channels; dropping the
      // declaration is closer to the authored intent than keeping an invalid one.
      declaration.remove();
      return;
    }
    const value = lowerValue(declaration.prop, declaration.value);
    if (value === undefined) declaration.remove();
    else declaration.value = value;
  });

  return copy;
}

/** Rewrite an emitted stylesheet for Chrome 92 without disturbing what modern engines see. */
export function chrome92(css: string): { css: string; changes: number } {
  const root = postcss.parse(css);
  let changes = 0;
  changes += addRgbTriplets(root);
  changes += addViewportFallbacks(root);

  const already = root.nodes.some(
    (node) => node.type === "atrule" && node.name === "supports" && node.params === LEGACY_GUARD,
  );
  if (!already) {
    const copy = legacyCopy(root.clone());
    if (copy.nodes.length > 0) {
      const guard = postcss.atRule({ name: "supports", params: LEGACY_GUARD });
      guard.append(copy.nodes);
      root.append(guard);
      changes += 1;
    }
  }

  return { css: root.toString(), changes };
}

/** Vite plugin: append the fallback copy to every emitted stylesheet. */
export function chrome92Css() {
  return {
    name: "mira:chrome92-css",
    apply: "build" as const,
    enforce: "post" as const,
    generateBundle(_options: unknown, bundle: Record<string, { type: string; source?: unknown }>) {
      for (const [name, file] of Object.entries(bundle)) {
        if (!name.endsWith(".css")) continue;
        if (file.type !== "asset" || typeof file.source !== "string") continue;
        const { css, changes } = chrome92(file.source);
        if (changes > 0) file.source = css;
      }
    },
  };
}
