import postcss, {
  type AtRule,
  type Container,
  type Declaration,
  type Root,
  type Rule,
} from "postcss";
import { transform, type Targets } from "lightningcss";

/**
 * Chrome 92 CSS compatibility pass, written as an *addition* to the stylesheet.
 *
 * The authored stylesheet stays untouched for modern browsers; a second copy is
 * appended inside `@supports not selector(:has(*))` (true on Chrome 83–104,
 * false on Chrome 105+). Inside that copy, every Tailwind v4 and daisyUI 5
 * construct that Chrome 92 rejects is rewritten to CSS 92 natively renders:
 *
 *  1. `@layer` (Chrome 99) is unwrapped in document order.
 *  2. `@supports` blocks for `color-mix()` and Tailwind's `@property` fallback
 *     are unwrapped so `--tw-*` initial values and translucent utilities apply.
 *  3. `:has()` (Chrome 105) branches are stripped from selector lists.
 *  4. `dvh`/`svh`/`lvh` (Chrome 108) and `lh` (Chrome 109) are lowered to `vh`/`em`.
 *  5. `in oklab`/`in oklch` gradient interpolation (Chrome 111) is stripped.
 *  6. Dynamic `oklch(100% 0 0 / <alpha>)` & `oklch(0% 0 0 / <alpha>)` shadows
 *     that Lightning CSS cannot statically fold (because `<alpha>` contains
 *     `var(--depth)`) are rewritten to `rgb(255 255 255 / <alpha>)` and
 *     `rgb(0 0 0 / <alpha>)`.
 *  7. `color-mix()` with `--color-*` tokens is rewritten to
 *     `rgb(var(--color-*-rgb) / <alpha>)` using auto-derived sRGB triplets.
 *  8. Independent transform properties `translate`, `rotate`, `scale`
 *     (Chrome 104) are split into non-inherited X/Y custom properties and
 *     composed with comma-separated `translate(x, y) rotate(r) scale(sx, sy)`.
 */

const TARGETS: Targets = { chrome: 92 << 16 };
const LEGACY_GUARD = "not selector(:has(*))";

const MODERN_COLOR = /\b(?:oklch|oklab|lab|lch|color-mix)\(/i;
const COLOR_VALUE =
  /^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\()/i;
const THEME_MIX =
  /color-mix\(\s*in\s+[a-z0-9-]+\s*,\s*var\((--color-[a-z0-9-]+)\)\s+([\d.]+%)\s*,\s*(?:transparent|#0000)\s*\)/gi;
const DYNAMIC_WHITE_OKLCH =
  /oklch\(\s*(?:100%|1)\s+0(?:\.0+)?\s+0(?:\.0+)?\s*\/\s*([^)]+)\)/gi;
const DYNAMIC_BLACK_OKLCH =
  /oklch\(\s*0%?\s+0(?:\.0+)?\s+0(?:\.0+)?\s*\/\s*([^)]+)\)/gi;
const GRADIENT_INTERPOLATION = /\s+in\s+(?:oklab|oklch|srgb|srgb-linear|lab|lch)\b/gi;
const DYNAMIC_VIEWPORT = /(?<=[0-9.])[sld]v([hw])/g;
const LINE_HEIGHT_UNIT = /(?<=[0-9.])lh\b/g;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const lowered = new Map<string, string | undefined>();

function lowerValue(property: string, value: string): string | undefined {
  if (!MODERN_COLOR.test(value)) return value;
  if (value.includes("color-mix(")) return undefined;
  const key = `${property}\u0000${value}`;
  if (lowered.has(key)) return lowered.get(key);
  let result: string | undefined;
  try {
    const output = decoder.decode(
      transform({
        filename: "value.css",
        code: encoder.encode(`a{${property}:${value}}`),
        minify: true,
        targets: TARGETS,
      }).code,
    );
    const parsed = postcss.parse(output);
    parsed.walkDecls((declaration) => {
      if (result === undefined && declaration.prop === property) {
        result = declaration.value;
      }
    });
  } catch {
    result = undefined;
  }
  lowered.set(key, result);
  return result;
}

function channels(value: string): string | undefined {
  const loweredValue = lowerValue("color", value) ?? value;
  const hex = /#([0-9a-f]{6})\b/i.exec(loweredValue)?.[1];
  if (!hex) return undefined;
  return [0, 2, 4]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
    .join(" ");
}

/** Split top-level comma-separated selectors at bracket depth 0. */
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
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Split whitespace-separated CSS tokens at top-level parenthesis depth 0. */
function splitSpaceTokens(value: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of value.trim()) {
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    if (/\s/.test(character) && depth === 0) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Add `--color-*-rgb: R G B` next to every `--color-*` palette declaration. */
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

/** Lower `100dvh` -> `100vh` and `1lh` -> `1.5em` inside a value string. */
function lowerUnits(value: string): string {
  let next = value;
  if (DYNAMIC_VIEWPORT.test(next)) {
    DYNAMIC_VIEWPORT.lastIndex = 0;
    next = next.replace(DYNAMIC_VIEWPORT, "v$1");
  }
  if (LINE_HEIGHT_UNIT.test(next)) {
    LINE_HEIGHT_UNIT.lastIndex = 0;
    next = next.replace(LINE_HEIGHT_UNIT, "em");
  }
  return next;
}

/** Keep `vh` ahead of every `dvh` declaration at the top level as well. */
function addViewportFallbacks(root: Root): number {
  let added = 0;
  root.walkDecls((declaration) => {
    const value = lowerUnits(declaration.value);
    if (value === declaration.value) return;
    const previous = declaration.prev();
    if (previous?.type === "decl" && previous.prop === declaration.prop && previous.value === value)
      return;
    declaration.cloneBefore({ value });
    added += 1;
  });
  return added;
}

function atRulesNamed(root: Container, name: string): AtRule[] {
  const found: AtRule[] = [];
  root.walkAtRules(name, (rule: AtRule) => {
    found.push(rule);
  });
  return found;
}

function insideKeyframes(rule: Rule): boolean {
  let parent = rule.parent as Container | undefined;
  while (parent) {
    if (parent.type === "atrule" && (parent as AtRule).name.endsWith("keyframes")) {
      return true;
    }
    parent = parent.parent as Container | undefined;
  }
  return false;
}

const COMPOSED_TRANSFORM =
  "translate(var(--mira-tx, 0px), var(--mira-ty, 0px)) " +
  "rotate(var(--mira-rot, 0deg)) " +
  "scale(var(--mira-sx, 1), var(--mira-sy, 1))";

/**
 * Rewrite `translate`, `rotate`, and `scale` declarations into `transform`.
 *
 * CSS `translate: X Y` is space-separated, whereas `transform: translate(X, Y)`
 * is comma-separated — passing a space-separated variable into `translate()`
 * makes the whole `transform` invalid at computed-value time. Splitting X and Y
 * into separate variables (`--mira-tx`, `--mira-ty`, `--mira-sx`, `--mira-sy`)
 * keeps the comma outside the `var()` and preserves independent cascading
 * between base rules (e.g. `.checkbox::before { rotate: 45deg }`) and state
 * rules (e.g. `.checkbox:checked::before { translate: 3.5% -7% }`).
 */
function rewriteTransforms(copy: Root): void {
  // Reset the custom properties on every element and pseudo-element so a
  // parent's translation/scale never inherits into its children.
  const reset = postcss.rule({
    selector: "*, ::before, ::after, ::backdrop",
  });
  reset.append(
    postcss.decl({ prop: "--mira-tx", value: "0px" }),
    postcss.decl({ prop: "--mira-ty", value: "0px" }),
    postcss.decl({ prop: "--mira-rot", value: "0deg" }),
    postcss.decl({ prop: "--mira-sx", value: "1" }),
    postcss.decl({ prop: "--mira-sy", value: "1" }),
  );
  copy.prepend(reset);

  copy.walkRules((rule: Rule) => {
    let translateVal: string | undefined;
    let rotateVal: string | undefined;
    let scaleVal: string | undefined;

    rule.walkDecls((declaration: Declaration) => {
      if (declaration.prop === "translate") {
        translateVal = declaration.value;
        declaration.remove();
      } else if (declaration.prop === "rotate") {
        rotateVal = declaration.value;
        declaration.remove();
      } else if (declaration.prop === "scale") {
        scaleVal = declaration.value;
        declaration.remove();
      } else if (declaration.prop === "transition" || declaration.prop === "transition-property") {
        declaration.value = declaration.value
          .replace(/\b(?:translate|rotate|scale)\b/g, "transform")
          .replace(/\s+allow-discrete\b/g, "");
      }
    });

    if (translateVal === undefined && rotateVal === undefined && scaleVal === undefined) return;

    if (insideKeyframes(rule)) {
      const parts: string[] = [];
      if (translateVal && translateVal !== "none") {
        const [x = "0px", y = "0px"] = splitSpaceTokens(translateVal);
        parts.push(`translate(${x}, ${y})`);
      }
      if (rotateVal && rotateVal !== "none") {
        parts.push(`rotate(${rotateVal})`);
      }
      if (scaleVal && scaleVal !== "none") {
        const [x = "1", y = x] = splitSpaceTokens(scaleVal);
        parts.push(`scale(${x}, ${y})`);
      }
      rule.append(
        postcss.decl({ prop: "transform", value: parts.length ? parts.join(" ") : "none" }),
      );
      return;
    }

    if (translateVal !== undefined) {
      if (translateVal === "none" || translateVal === "0") {
        rule.append(
          postcss.decl({ prop: "--mira-tx", value: "0px" }),
          postcss.decl({ prop: "--mira-ty", value: "0px" }),
        );
      } else {
        const [x = "0px", y = "0px"] = splitSpaceTokens(translateVal);
        rule.append(
          postcss.decl({ prop: "--mira-tx", value: x }),
          postcss.decl({ prop: "--mira-ty", value: y }),
        );
      }
    }

    if (rotateVal !== undefined) {
      rule.append(
        postcss.decl({
          prop: "--mira-rot",
          value: rotateVal === "none" ? "0deg" : rotateVal,
        }),
      );
    }

    if (scaleVal !== undefined) {
      if (scaleVal === "none") {
        rule.append(
          postcss.decl({ prop: "--mira-sx", value: "1" }),
          postcss.decl({ prop: "--mira-sy", value: "1" }),
        );
      } else {
        const [x = "1", y = x] = splitSpaceTokens(scaleVal);
        rule.append(
          postcss.decl({ prop: "--mira-sx", value: x }),
          postcss.decl({ prop: "--mira-sy", value: y }),
        );
      }
    }

    rule.append(postcss.decl({ prop: "transform", value: COMPOSED_TRANSFORM }));
  });
}

/** Build the Chrome 92 fallback stylesheet that lives inside `@supports not selector(:has(*))`. */
function legacyCopy(root: Root): Root {
  const copy = root.clone();

  // 1. Unwrap every `@layer` in document order.
  for (
    let remaining = atRulesNamed(copy, "layer");
    remaining.length > 0;
    remaining = atRulesNamed(copy, "layer")
  ) {
    for (const rule of remaining) {
      if (!rule.nodes) {
        rule.remove();
        continue;
      }
      const parent = rule.parent as Container;
      const children = [...rule.nodes];
      for (const node of children) parent.insertBefore(rule, node);
      rule.remove();
    }
  }

  // 2. Unwrap `@supports` blocks that gate `color-mix()` or Tailwind's
  //    `--tw-*` property initialiser block, and drop `@property` / `@starting-style`.
  for (const rule of atRulesNamed(copy, "supports")) {
    if (/color-mix\(|margin-trim|-moz-orient/.test(rule.params)) {
      const parent = rule.parent as Container;
      const children = [...(rule.nodes ?? [])];
      for (const node of children) parent.insertBefore(rule, node);
      rule.remove();
    }
  }
  for (const rule of atRulesNamed(copy, "property")) rule.remove();
  for (const rule of atRulesNamed(copy, "starting-style")) rule.remove();

  // 3. Unwrap `@scope (.join)` by prefixing its inner selectors with `.join `.
  for (const rule of atRulesNamed(copy, "scope")) {
    const scopeMatch = /\(\s*([^)]+?)\s*\)/.exec(rule.params);
    const prefix = scopeMatch?.[1];
    const parent = rule.parent as Container;
    if (prefix && rule.nodes) {
      rule.walkRules((inner: Rule) => {
        inner.selector = splitSelectors(inner.selector)
          .map((part) => `${prefix} ${part}`)
          .join(", ");
      });
      const children = [...rule.nodes];
      for (const node of children) parent.insertBefore(rule, node);
    }
    rule.remove();
  }

  // 4. Strip `:has()` branches from selector lists.
  copy.walkRules((rule: Rule) => {
    if (!rule.selector.includes(":has(")) return;
    const kept = splitSelectors(rule.selector).filter((part) => !part.includes(":has("));
    if (kept.length === 0) rule.remove();
    else rule.selector = kept.join(", ");
  });

  // 5. Lower `translate`, `rotate`, and `scale` into comma-separated `transform`.
  rewriteTransforms(copy);

  // 6. Lower values: units (`dvh`/`lh`), gradient interpolation (`in oklab`),
  //    dynamic `oklch()` white/black alphas, `color-mix()`, and static `oklch()`.
  copy.walkDecls((declaration: Declaration) => {
    let value = lowerUnits(declaration.value);

    if (GRADIENT_INTERPOLATION.test(value)) {
      GRADIENT_INTERPOLATION.lastIndex = 0;
      value = value.replace(GRADIENT_INTERPOLATION, "");
    }

    if (DYNAMIC_WHITE_OKLCH.test(value)) {
      DYNAMIC_WHITE_OKLCH.lastIndex = 0;
      value = value.replace(DYNAMIC_WHITE_OKLCH, "rgb(255 255 255 / $1)");
    }

    if (DYNAMIC_BLACK_OKLCH.test(value)) {
      DYNAMIC_BLACK_OKLCH.lastIndex = 0;
      value = value.replace(DYNAMIC_BLACK_OKLCH, "rgb(0 0 0 / $1)");
    }

    if (value.includes("color-mix(")) {
      THEME_MIX.lastIndex = 0;
      value = value.replace(
        THEME_MIX,
        (_match, name: string, percent: string) => `rgb(var(${name}-rgb) / ${percent})`,
      );
      if (value.includes("color-mix(")) {
        declaration.remove();
        return;
      }
      declaration.value = value;
      return;
    }

    const loweredVal = lowerValue(declaration.prop, value);
    if (loweredVal === undefined) {
      declaration.remove();
    } else {
      declaration.value = loweredVal;
    }
  });

  return copy;
}

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
