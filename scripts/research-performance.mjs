import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
const root = ".svelte-kit/output/client";
const manifest = JSON.parse(readFileSync(root + "/.vite/manifest.json", "utf8"));
const keys = Object.keys(manifest);
function graph(initial) {
  const found = new Set();
  function visit(key) {
    if (found.has(key)) return;
    found.add(key);
    for (const dep of manifest[key]?.imports ?? []) visit(dep);
  }
  initial.forEach(visit);
  return [...found];
}
const entries = keys.filter(
  (key) => manifest[key].isEntry && /entry\/(app|start)$/.test(manifest[key].name),
);
function measure(nodes) {
  const route = nodes.map((id) => keys.find((key) => manifest[key].name === "nodes/" + id));
  if (route.some((key) => !key)) throw Error("Build route manifest missing");
  const files = graph([...entries, ...route])
    .map((key) => manifest[key]?.file)
    .filter((file) => file?.endsWith(".js"));
  const details = files.map((file) => {
    const data = readFileSync(root + "/" + file);
    return { file, bytes: data.length, gzip: gzipSync(data).length };
  });
  return {
    files: files.length,
    bytes: details.reduce((n, f) => n + f.bytes, 0),
    gzip: details.reduce((n, f) => n + f.gzip, 0),
    largest: details.toSorted((a, b) => b.gzip - a.gzip).slice(0, 5),
  };
}
const result = {
  measuredAt: new Date().toISOString(),
  scope:
    "Build dependency closure; estimated gzip bytes, excludes dynamic imports and network behavior.",
  participation: measure([0, 2, 6]),
  workspace: measure([0, 3, 7]),
};
mkdirSync(".pi/fabric", { recursive: true });
writeFileSync(".pi/fabric/research-performance.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
