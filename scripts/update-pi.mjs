#!/usr/bin/env node
// Deliberately advance Pi to upstream main. For locked installs use prepare-pi.mjs.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  artifactDirectory,
  assertConsumer,
  captureSnapshot,
  checkoutSource,
  createBuildDirectory,
  git,
  installBuildDependencies,
  npm,
  packSource,
  preparePi,
  publishArtifacts,
  readJson,
  repository,
  run,
  validateManifest,
} from "./pi-packages.mjs";

const consumer = process.cwd();
let directory;
try {
  const { values } = parseArgs({
    options: { "model-catalog-revision": { type: "string" } },
  });
  // Old local references must exist before Bun can replace their lock entries.
  const previous = preparePi(consumer);
  const commit = git(
    ["-c", "credential.helper=", "ls-remote", repository, "refs/heads/main"],
    consumer,
  ).split(/\s+/)[0];
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Could not resolve upstream Pi main");
  directory = createBuildDirectory(consumer);
  installBuildDependencies(consumer, directory, previous);
  const source = join(directory, "vendor/pi");
  checkoutSource(source, commit);

  // Hydrate a verified immutable catalog, defaulting to the upstream Nix pin.
  const { revision: upstreamRevision } = readJson(join(source, "nix/model-catalog.json"));
  const revision = values["model-catalog-revision"] ?? upstreamRevision;
  if (!/^sha256-[a-f0-9]{64}$/.test(revision))
    throw new Error("Invalid upstream model catalog revision");
  const response = await fetch(
    `https://pi.dev/api/models/revisions/${revision}?types=chat,image,classifier`,
    {
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!response.ok) throw new Error(`Model catalog download failed: HTTP ${response.status}`);
  const catalog = Buffer.from(await response.arrayBuffer());
  if (`sha256-${createHash("sha256").update(catalog).digest("hex")}` !== revision) {
    throw new Error("Upstream model catalog digest mismatch");
  }
  const catalogPath = join(directory, "models.all.json");
  writeFileSync(catalogPath, catalog);
  run(process.execPath, ["packages/ai/scripts/hydrate-model-catalog.ts", catalogPath], source);
  const built = packSource(source);
  const manifest = validateManifest({
    ...built,
    source: { repository, ...built.source },
    artifactDirectory,
    build: {
      node: process.versions.node,
      npm: npm("--version", source),
      platform: process.platform,
      arch: process.arch,
      modelCatalogRevision: revision,
      dependencyLock: previous.build.dependencyLock,
      modelData: captureSnapshot(consumer, source),
    },
  });
  publishArtifacts(join(source, ".artifacts/packages"), consumer, manifest);

  const files = ["package.json", "bun.lock", "pi-packages.json"];
  const before = new Map(files.map((file) => [file, readFileSync(join(consumer, file))]));
  const pkg = readJson(join(consumer, "package.json"));
  const names = new Set(manifest.packages.map((entry) => entry.name));
  const direct = ["dependencies", "devDependencies", "optionalDependencies"]
    .flatMap((section) => Object.keys(pkg[section] ?? {}))
    .filter((name) => names.has(name));
  if (!direct.length) throw new Error("Consumer has no direct Pi dependencies");
  try {
    run(
      process.execPath,
      [
        "scripts/use-local-packages.mjs",
        "--manifest",
        join(consumer, artifactDirectory, "manifest.json"),
        "--consumer",
        consumer,
        ...direct.flatMap((name) => ["--package", name]),
      ],
      source,
    );
    run("bun", ["update", "--lockfile-only", "--ignore-scripts", ...direct], consumer);
    assertConsumer(consumer, manifest);
    run("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], consumer);
    writeFileSync(join(consumer, "pi-packages.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    for (const [file, bytes] of before) writeFileSync(join(consumer, file), bytes);
    throw new Error(
      `Pi update failed; restored package.json, bun.lock and provenance. Old archives remain available. Run bun install --frozen-lockfile --ignore-scripts to restore installed dependencies. ${error.message}`,
      { cause: error },
    );
  }
  const snapshots = join(consumer, "scripts/pi-model-data");
  for (const name of readdirSync(snapshots)) {
    if (
      /^[a-f0-9]{12}\.json\.gz$/.test(name) &&
      `scripts/pi-model-data/${name}` !== manifest.build.modelData.path
    )
      rmSync(join(snapshots, name));
  }
  rmSync(directory, { recursive: true, force: true });
  console.log(
    `Updated Pi to ${commit}. Review package.json, bun.lock, pi-packages.json and scripts/pi-model-data together.`,
  );
} catch (error) {
  console.error(error.message);
  if (directory) console.error(`Build evidence retained at ${directory}`);
  process.exitCode = 1;
}
