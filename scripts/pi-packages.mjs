// Shared tooling for pinned restoration and deliberate upstream updates.
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

export const repository = "https://github.com/earendil-works/pi.git";
export const artifactDirectory = "vendor/pi/.artifacts/main";
const dataDirectory = "packages/ai/src/providers/data";
export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
export const integrity = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
export const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    timeout: 1_200_000,
  });
export const git = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 180_000,
  }).trim();

// Only fixed npm commands reach the shell (Windows npm is a .cmd shim).
export function npm(command, cwd) {
  if (
    ![
      "--version",
      "ci --ignore-scripts --no-audit --no-fund",
      "run pack:packages -- --out .artifacts/packages --offline-model-data",
    ].includes(command)
  ) {
    throw new Error("Unsupported npm command");
  }
  // Nested npm scripts repeatedly prepend ancestor .bin paths. On Windows a
  // deep cold checkout can exceed cmd.exe's 8191-character environment limit,
  // making tools such as shx disappear. Git for Windows supplies a POSIX shell
  // that preserves PATH; use it only for the source build's lifecycle scripts.
  let env = process.env;
  if (process.platform === "win32" && command.startsWith("run pack:packages")) {
    const shell = join(git(["--exec-path"], cwd), "../../../bin/bash.exe");
    if (!existsSync(shell)) throw new Error(`Git for Windows build shell not found: ${shell}`);
    env = { ...process.env, npm_config_script_shell: shell };
  }
  return execSync(`npm ${command}`, {
    cwd,
    env,
    encoding: "utf8",
    stdio: command === "--version" ? "pipe" : "inherit",
    timeout: 1_200_000,
  })?.trim();
}

export function validateManifest(manifest) {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.source?.repository !== repository ||
    !/^[a-f0-9]{40}$/.test(manifest.source?.commit) ||
    manifest.source.dirty !== false ||
    manifest.artifactDirectory !== artifactDirectory ||
    !manifest.packages?.length
  ) {
    throw new Error("Invalid Pi provenance in pi-packages.json");
  }
  const names = new Set();
  for (const pkg of manifest.packages) {
    if (
      !/^@earendil-works\/[a-z0-9-]+$/.test(pkg.name) ||
      !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(pkg.version) ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.integrity) ||
      names.has(pkg.name)
    ) {
      throw new Error(`Invalid Pi package entry: ${pkg.name}`);
    }
    names.add(pkg.name);
    const hash = Buffer.from(pkg.integrity.slice(7), "base64").toString("hex").slice(0, 12);
    const filename = `${pkg.name.slice(1).replace("/", "-")}-${pkg.version}-${hash}.tgz`;
    if (pkg.tarball !== `tarballs/${filename}`)
      throw new Error(`Invalid content filename: ${pkg.tarball}`);
  }
  const data = manifest.build?.modelData;
  if (
    !/^scripts\/pi-model-data\/[a-f0-9]{12}\.json\.gz$/.test(data?.path) ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(data?.integrity) ||
    !/^\d+\.\d+\.\d+$/.test(manifest.build?.node) ||
    !/^\d+\.\d+\.\d+$/.test(manifest.build?.npm) ||
    manifest.build?.dependencyLock?.path !== "scripts/pi-build/package-lock.json" ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(manifest.build?.dependencyLock?.integrity)
  ) {
    throw new Error("Invalid Pi build input provenance");
  }
  return manifest;
}

export function assertConsumer(consumer, manifest) {
  const pkg = readJson(join(consumer, "package.json"));
  // Bun's own JSONC parser avoids a second, subtly different lock parser.
  const lock = JSON.parse(
    execFileSync(
      "bun",
      [
        "-e",
        "process.stdout.write(JSON.stringify(Bun.JSONC.parse(await Bun.file('bun.lock').text())))",
      ],
      { cwd: consumer, encoding: "utf8", timeout: 30_000 },
    ),
  );
  const byName = new Map(manifest.packages.map((entry) => [entry.name, entry]));
  const specifier = (entry) => `file:./${artifactDirectory}/${entry.tarball}`;
  for (const config of [pkg, lock.workspaces?.[""], { overrides: lock.overrides }]) {
    if (!config) throw new Error("Missing consumer workspace in bun.lock");
    for (const section of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "overrides",
    ]) {
      for (const [name, value] of Object.entries(config[section] ?? {})) {
        if (!name.startsWith("@earendil-works/")) continue;
        const entry = byName.get(name);
        if (!entry || value !== specifier(entry)) {
          throw new Error(
            `${section}.${name} disagrees with pi-packages.json; restore matching package/lock/provenance files together`,
          );
        }
      }
    }
  }
  for (const entry of manifest.packages) {
    if (
      pkg.overrides?.[entry.name] !== specifier(entry) ||
      lock.overrides?.[entry.name] !== specifier(entry)
    ) {
      throw new Error(`Missing pinned override: ${entry.name}`);
    }
  }
  for (const [key, row] of Object.entries(lock.packages ?? {})) {
    // Lock keys are install paths: @earendil-works/chord/typebox is TypeBox,
    // not a Pi artifact. Read the package identity from the resolution instead.
    const name = typeof row[0] === "string" ? /^(@[^/]+\/[^@]+|[^@]+)@/.exec(row[0])?.[1] ?? "" : "";
    if (!byName.has(key) && !name.startsWith("@earendil-works/")) continue;
    const entry = byName.get(name);
    if (
      !entry ||
      row[0] !== `${name}@./${artifactDirectory}/${entry.tarball}` ||
      row.at(-1) !== entry.integrity
    ) {
      throw new Error(`Locked Pi artifact disagrees with provenance: ${key}`);
    }
  }
}

export function verifyArtifacts(directory, manifest) {
  const missing = [];
  for (const pkg of manifest.packages) {
    const path = join(directory, pkg.tarball);
    if (!existsSync(path)) missing.push(pkg.name);
    else if (integrity(readFileSync(path)) !== pkg.integrity) {
      throw new Error(
        `Pi artifact integrity mismatch: ${path}. Remove this corrupt archive and rerun pi:prepare.`,
      );
    }
  }
  return missing;
}

export function createBuildDirectory(consumer) {
  const parent = join(consumer, "vendor/pi/.artifacts");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, "bootstrap-"));
}

export function installBuildDependencies(consumer, directory, manifest) {
  const input = manifest.build.dependencyLock;
  if (input?.path !== "scripts/pi-build/package-lock.json")
    throw new Error("Invalid Pi build dependency lock path");
  const bytes = readFileSync(join(consumer, input.path));
  if (integrity(bytes) !== input.integrity)
    throw new Error("Pi build dependency lock integrity mismatch");
  const lock = JSON.parse(bytes.toString("utf8"));
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ ...lock.packages[""], private: true }),
  );
  writeFileSync(join(directory, "package-lock.json"), bytes);
  npm("ci --ignore-scripts --no-audit --no-fund", directory);
}

export function checkoutSource(directory, commit) {
  mkdirSync(directory, { recursive: true });
  run("git", ["init", "--quiet", directory]);
  run("git", ["remote", "add", "origin", repository], directory);
  run("git", ["-c", "credential.helper=", "fetch", "--depth=1", "origin", commit], directory);
  run("git", ["-c", "core.autocrlf=false", "checkout", "--detach", "FETCH_HEAD"], directory);
  if (git(["rev-parse", "HEAD"], directory) !== commit)
    throw new Error("Fetched Pi commit does not match provenance");
}

export function hydrateSnapshot(consumer, source, manifest) {
  const input = manifest.build.modelData;
  const bytes = readFileSync(join(consumer, input.path));
  if (integrity(bytes) !== input.integrity)
    throw new Error(`Pi model snapshot integrity mismatch: ${input.path}`);
  const files = JSON.parse(gunzipSync(bytes).toString("utf8"));
  if (!Object.hasOwn(files, ".manifest.json"))
    throw new Error("Pi model snapshot has no generation manifest");
  const target = join(source, dataDirectory);
  mkdirSync(target, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    if (!/^(?:\.manifest|[a-z0-9-]+)\.json$/.test(name) || typeof content !== "string") {
      throw new Error(`Invalid Pi model snapshot entry: ${name}`);
    }
    writeFileSync(join(target, name), content);
  }
}

export function captureSnapshot(consumer, source) {
  const directory = join(source, dataDirectory);
  const files = Object.fromEntries(
    readdirSync(directory)
      .sort()
      .map((name) => [name, readFileSync(join(directory, name), "utf8")]),
  );
  const bytes = gzipSync(Buffer.from(`${JSON.stringify(files)}\n`), { level: 9 });
  const hash = createHash("sha512").update(bytes).digest("hex").slice(0, 12);
  const path = `scripts/pi-model-data/${hash}.json.gz`;
  mkdirSync(dirname(join(consumer, path)), { recursive: true });
  writeFileSync(join(consumer, path), bytes);
  return { path, integrity: integrity(bytes) };
}

export function packSource(source) {
  npm("ci --ignore-scripts --no-audit --no-fund", source);
  npm("run pack:packages -- --out .artifacts/packages --offline-model-data", source);
  const manifest = readJson(join(source, ".artifacts/packages/manifest.json"));
  if (manifest.source.dirty || git(["status", "--porcelain"], source)) {
    throw new Error(
      "Upstream build changed tracked Pi source; refusing to record a clean commit for it",
    );
  }
  return manifest;
}

export function publishArtifacts(sourceDirectory, consumer, manifest) {
  const missing = verifyArtifacts(sourceDirectory, manifest);
  if (missing.length)
    throw new Error(
      `Rebuild did not reproduce locked filenames: ${missing.join(", ")}. No consumer locks were changed. Inspect the retained build; do not rename different bytes to locked filenames.`,
    );
  const target = join(consumer, artifactDirectory);
  mkdirSync(join(target, "tarballs"), { recursive: true });
  // Retain old archives: Bun reads them while replacing the lock.
  for (const pkg of manifest.packages) {
    const path = join(target, pkg.tarball);
    if (existsSync(path)) {
      if (integrity(readFileSync(path)) !== pkg.integrity)
        throw new Error(`Refusing to overwrite corrupt artifact: ${path}`);
      continue;
    }
    const temporary = `${path}.${process.pid}.tmp`;
    copyFileSync(join(sourceDirectory, pkg.tarball), temporary);
    renameSync(temporary, path);
  }
  writeFileSync(
    join(target, "manifest.json"),
    `${JSON.stringify({ schemaVersion: 1, source: { commit: manifest.source.commit, dirty: false }, packages: manifest.packages }, null, 2)}\n`,
  );
}

export function preparePi(consumer) {
  const manifest = validateManifest(readJson(join(consumer, "pi-packages.json")));
  assertConsumer(consumer, manifest);
  const missing = verifyArtifacts(join(consumer, artifactDirectory), manifest);
  if (!missing.length) {
    console.log(
      `Verified ${manifest.packages.length} pinned Pi artifacts (${manifest.source.commit}).`,
    );
    return manifest;
  }
  const npmVersion = npm("--version", consumer);
  if (process.versions.node !== manifest.build.node || npmVersion !== manifest.build.npm) {
    throw new Error(
      `Cold Pi restore requires Node ${manifest.build.node} and npm ${manifest.build.npm}; found Node ${process.versions.node}, npm ${npmVersion}.`,
    );
  }
  const directory = createBuildDirectory(consumer);
  console.log(`Restoring ${missing.length} missing Pi archives in ${directory}`);
  try {
    installBuildDependencies(consumer, directory, manifest);
    const source = join(directory, "vendor/pi");
    checkoutSource(source, manifest.source.commit);
    hydrateSnapshot(consumer, source, manifest);
    const built = packSource(source);
    if (built.source.commit !== manifest.source.commit) throw new Error("Pi build source mismatch");
    publishArtifacts(join(source, ".artifacts/packages"), consumer, manifest);
  } catch (error) {
    throw new Error(`Pi restore failed; retained build at ${directory}: ${error.message}`, {
      cause: error,
    });
  }
  rmSync(directory, { recursive: true, force: true });
  console.log(
    `Restored and verified ${manifest.packages.length} pinned Pi artifacts. package.json and bun.lock were not modified.`,
  );
  return manifest;
}
