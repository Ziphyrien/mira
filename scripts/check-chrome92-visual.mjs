#!/usr/bin/env node
/**
 * Prove the Chrome 92 compatibility layer changes nothing for modern engines.
 *
 * The build appends a `@supports not selector(:has(*))` copy of the stylesheet
 * for old engines. On a modern engine that condition is false, so the copy must
 * contribute nothing. This checks it the only way that isolates the stylesheet
 * from everything else: load each route once, snapshot computed styles for every
 * element, delete the guarded rule through the CSSOM, snapshot again, and diff.
 *
 * One page, one DOM, one hydration state — so a difference can only come from
 * the guarded CSS. A second snapshot with no change guards against flakiness.
 *
 * Usage: node scripts/check-chrome92-visual.mjs [baseURL]
 */
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseURL = process.argv[2] ?? process.env.MIRA_TEST_URL ?? "http://localhost:8791";
const routes = (process.env.MIRA_CHECK_ROUTES ?? "/,/research,/admin").split(",").filter(Boolean);

/** Use whatever Chromium this machine already has, so the check works offline. */
function chromiumExecutable() {
  const root = resolve(process.env.LOCALAPPDATA ?? ".", "ms-playwright");
  if (!existsSync(root)) return undefined;
  for (const entry of readdirSync(root)
    .filter((name) => name.startsWith("chromium-"))
    .sort()
    .reverse()) {
    for (const dir of ["chrome-win64", "chrome-win"]) {
      const executable = resolve(root, entry, dir, "chrome.exe");
      if (existsSync(executable)) return executable;
    }
  }
  return undefined;
}

/** Computed style of every element, keyed by DOM path so both passes align. */
const snapshot = () => {
  const styles = [];
  const walk = (element, path) => {
    const computed = getComputedStyle(element);
    const entry = { path, tag: element.tagName, classes: String(element.className) };
    for (const property of computed) entry[property] = computed.getPropertyValue(property);
    styles.push(entry);
    [...element.children].forEach((child, index) => walk(child, `${path}>${index}`));
  };
  walk(document.documentElement, "html");
  return styles;
};

/** Delete the Chrome 92 copy from every stylesheet; returns how many were removed. */
const dropGuard = () => {
  let removed = 0;
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet
    }
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      const rule = rules[index];
      const condition = rule.conditionText ?? "";
      if (rule.constructor.name === "CSSSupportsRule" && condition.includes("selector(:has(*))")) {
        sheet.deleteRule(index);
        removed += 1;
      }
    }
  }
  return removed;
};

const browser = await chromium.launch({ executablePath: chromiumExecutable() });
let failures = 0;

try {
  const context = await browser.newContext();
  const page = await context.newPage();

  for (const route of routes) {
    await page.goto(baseURL + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);

    const before = await page.evaluate(snapshot);
    const again = await page.evaluate(snapshot);
    const removed = await page.evaluate(dropGuard);
    await page.waitForTimeout(120);
    const after = await page.evaluate(snapshot);

    const stable = JSON.stringify(before) === JSON.stringify(again);
    const differences = [];
    if (before.length !== after.length)
      differences.push(`element count ${before.length} -> ${after.length}`);
    for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
      const a = before[index];
      const b = after[index];
      for (const key of Object.keys(a)) {
        if (key === "path" || key === "tag" || key === "classes") continue;
        if (a[key] === b[key]) continue;
        differences.push(`${b.path} ${b.tag}.${b.classes.slice(0, 40)} ${key}: ${a[key]} -> ${b[key]}`);
        if (differences.length > 12) break;
      }
      if (differences.length > 12) break;
    }

    const ok = stable && differences.length === 0 && removed > 0;
    if (!ok) failures += 1;
    console.log(
      `${ok ? "✓" : "✗"} ${route}  ${after.length} elements, removed ${removed} guarded rule(s), ` +
        `stable=${stable}, differences=${differences.length}`,
    );
    for (const difference of differences.slice(0, 6)) console.log(`    ${difference}`);
  }

  await context.close();
} finally {
  await browser.close();
}

console.log(failures ? "\nFAILED" : "\nmodern engines unaffected by the compatibility layer");
process.exit(failures ? 1 : 0);
