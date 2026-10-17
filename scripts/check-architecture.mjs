import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();
const normalize = (path) => relative(root, path).replaceAll("\\", "/");
const files = ["src", "worker"].flatMap((directory) =>
  readdirSync(directory, { recursive: true })
    .map((file) => `${directory}/${file.replaceAll("\\", "/")}`)
    .filter(
      (file) =>
        /\.(ts|svelte)$/.test(file) &&
        !/\.(test|d)\.ts$/.test(file) &&
        !file.startsWith("worker/testing/"),
    ),
);
const known = new Set(files);
const graph = new Map(files.map((file) => [file, new Set()]));
const failures = new Set();
let imports = 0;
function targetOf(from, specifier) {
  let target;
  if (specifier.startsWith("#lib/")) target = resolve("src/lib", specifier.slice(5));
  else if (specifier.startsWith(".")) target = resolve(dirname(from), specifier);
  else return undefined;
  const stem = target.replace(/\.js$/, "");
  const candidates =
    extname(target) === ".svelte" ? [target] : [target, `${stem}.ts`, `${stem}/index.ts`];
  return candidates.find((candidate) => existsSync(candidate) && known.has(normalize(candidate)));
}
function isTypeOnly(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    const named = clause.namedBindings;
    return (
      !clause.name &&
      named &&
      ts.isNamedImports(named) &&
      named.elements.length > 0 &&
      named.elements.every((element) => element.isTypeOnly)
    );
  }
  return (
    node.isTypeOnly ||
    (node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.length > 0 &&
      node.exportClause.elements.every((element) => element.isTypeOnly))
  );
}
function checkBoundary(from, to) {
  if (from.startsWith("src/lib/contracts/") && !to.startsWith("src/lib/contracts/"))
    failures.add(`${from} → ${to}: shared contracts depend on an implementation layer`);
  if (from.startsWith("src/lib/shared/") && !/^src\/lib\/(shared|contracts)\//.test(to))
    failures.add(`${from} → ${to}: shared code depends on a feature or host`);
  if (
    from.startsWith("worker/") &&
    to.startsWith("src/") &&
    !/^src\/lib\/(contracts|shared)\//.test(to)
  )
    failures.add(`${from} → ${to}: Worker depends on a web implementation`);
  if (/^src\/lib\/(app|plugins|ui)\//.test(from) && /^(worker\/|src\/lib\/server\/)/.test(to))
    failures.add(`${from} → ${to}: browser code depends on a server implementation`);
  const sourceFeature = /^(worker|src\/lib)\/plugins\/([^/]+)\//.exec(from);
  const targetFeature = /^(worker|src\/lib)\/plugins\/([^/]+)\/(.+)$/.exec(to);
  if (
    sourceFeature &&
    targetFeature &&
    sourceFeature[1] === targetFeature[1] &&
    sourceFeature[2] !== targetFeature[2] &&
    !["api.ts", "ports.ts"].includes(targetFeature[3])
  )
    failures.add(`${from} → ${to}: cross-feature imports must use the feature's public contract`);
}
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const sources = file.endsWith(".svelte")
    ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1])
    : [text];
  for (const source of sources) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    for (const node of ast.statements) {
      if (
        !(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ||
        !node.moduleSpecifier ||
        !ts.isStringLiteral(node.moduleSpecifier)
      )
        continue;
      const resolved = targetOf(file, node.moduleSpecifier.text);
      if (!resolved) continue;
      const target = normalize(resolved);
      imports++;
      checkBoundary(file, target);
      if (!isTypeOnly(node)) graph.get(file).add(target);
    }
  }
}
const visited = new Set();
const active = new Set();
const path = [];
function visit(file) {
  if (active.has(file)) {
    failures.add(`Runtime import cycle: ${[...path.slice(path.indexOf(file)), file].join(" → ")}`);
    return;
  }
  if (visited.has(file)) return;
  visited.add(file);
  active.add(file);
  path.push(file);
  for (const dependency of graph.get(file)) visit(dependency);
  path.pop();
  active.delete(file);
}
for (const file of files) visit(file);
if (failures.size) {
  console.error([...failures].join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Architecture: ${files.length} production files, ${imports} internal imports; boundaries and runtime cycles passed.`,
  );
}
