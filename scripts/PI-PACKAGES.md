# Pi package bootstrap

Pi is consumed as content-addressed local tarballs. `pi-packages.json` pins the upstream Git commit, exact archive filenames and SHA512 integrities, build tool versions, and the model-data snapshot needed to reproduce those bytes. Keep it together with `package.json`, `bun.lock`, `scripts/pi-build/package-lock.json`, and the model-data snapshot referenced by the manifest in version control. Tarballs and build directories stay ignored under `vendor/pi/.artifacts`.

From the repository root, before the first install:

```sh
node scripts/prepare-pi.mjs
bun install --frozen-lockfile --ignore-scripts
```

`pi:prepare` restores and verifies the locked Pi packages; `pi:update` deliberately advances them to upstream `main`. CI must explicitly run `node scripts/prepare-pi.mjs` before `bun install --frozen-lockfile --ignore-scripts`. A `prepare` or `postinstall` lifecycle hook is too late for missing local tarballs, and `--ignore-scripts` skips hooks.

The warm path checks package/lock/provenance agreement and hashes all ten existing archives. It needs Node and Bun, but no Git, npm, network, or installed Mira dependencies. It never rewrites package.json or bun.lock. A corrupt archive fails with its path; remove only that archive and rerun. Missing archives trigger an isolated checkout of the exact commit, `npm ci --ignore-scripts`, restoration of the recorded model-data snapshot, and upstream `pack:packages --offline-model-data`. All expected filenames and hashes must match before any rebuilt tarball is installed. Existing vendor source and unrelated archives are never reset, stashed, pulled, or removed. Failed builds remain under `vendor/pi/.artifacts/bootstrap-*` for diagnosis; successful temporary builds are removed.

Cold builds require Git, network access to GitHub/npm, and the exact Node/npm versions recorded in the manifest. The initial artifact set was built with Node 26.7.0, npm 11.8.0, Windows x64. On Windows, source builds use the Bash shipped with Git for Windows for npm lifecycle scripts: nested npm scripts can otherwise exceed `cmd.exe`'s PATH limit in deep checkout directories. Platform/architecture are recorded for diagnosis; every platform must pass the same byte verification. A source build takes several minutes and substantial disk space. Hash mismatch is a reproducibility failure, never permission to refresh a lock. Use the recorded build environment or investigate the retained outputs before proposing a deliberate artifact/lock update.

The build host also has a tiny, integrity-pinned npm lock in `scripts/pi-build/package-lock.json`. The original coding-agent bundle resolved the optional `supports-color@10.2.2` peer from Mira, outside Pi’s own lockfile. The bootstrap installs that exact dependency in a private build host and checks out Pi at `vendor/pi` underneath it, preserving esbuild’s `../../node_modules` module identifiers. It never relies on the consumer having this package installed. This is a build input, not a runtime compatibility layer.

The compressed model snapshot is public build input, not executable code or credentials. It contains the upstream provider JSON files as strings, including their original `.manifest.json` timestamp. Git alone cannot restore that ignored data. Running the live generator again would change the timestamp and may change model catalogs, producing different locked tarballs. The snapshot is SHA512-verified before decompression. This small input is retained instead of checking in all compiled packages.

Use a shell where `node --version` and `npm --version` match the versions recorded in `pi-packages.json` before a cold restore. Package-manager wrappers can select a different Node/npm toolchain when running scripts. For example, this host's Vite Plus `bun` shim selects Node 24 even when the outer shell selects Node 26. The direct Node command above avoids that script-entry substitution. An ordinary Bun installation can also run `bun run pi:prepare` with the same selected toolchain; the warm path does not require the recorded build versions.

To deliberately advance Pi using the selected Node/npm toolchain:

```sh
node scripts/update-pi.mjs
```

A compatible published catalog revision can be selected with `node scripts/update-pi.mjs --model-catalog-revision sha256-<64 hex characters>` when provider source changes precede the catalog pinned by upstream. The updater downloads that immutable revision, verifies its SHA256, and records the selected revision and hydrated snapshot in `pi-packages.json`. Cold restores use the recorded snapshot.

`bun run pi:update` is the registered equivalent when Bun preserves that toolchain. The isolated update verification used native Bun 1.4.3 with Node 26.7.0 and npm 11.8.0; it does not establish that this host's Vite Plus-wrapped command uses those versions. Update records the actual Node/npm versions used to build its new artifacts. Unlike a cold restore of existing artifacts, a warm-start update can deliberately build with another toolchain, whose versions then become required for subsequent cold restores. The update script calls `bun update --lockfile-only --ignore-scripts` and `bun install --frozen-lockfile --ignore-scripts` as child processes; these dependency operations do not run consumer lifecycle scripts.

Update first restores the old locked artifacts so a fresh checkout can update successfully. It resolves upstream `main` once, fetches that exact commit into a separate directory, verifies and hydrates the commit's immutable pi.dev model catalog using upstream's Nix build recipe, then builds offline. It captures the resulting model snapshot, uses upstream's consumer wiring script, replaces the Bun lock, performs a frozen install, and records new provenance. After a successful install and provenance update, it keeps only the model snapshot referenced by the new manifest. Failed updates retain snapshots for recovery. Old tarballs remain in the ignored artifact cache. If lock replacement or installation fails, it restores the original package/lock/provenance bytes; the error explains how to restore installed dependencies. Review the tracked package, lock, provenance, and build inputs together. No existing vendor checkout is required, and `PI_REPO` is no longer used.
