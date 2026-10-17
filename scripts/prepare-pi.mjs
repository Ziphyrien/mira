#!/usr/bin/env node
// Run before dependency resolution, including installs with lifecycle scripts disabled.
import { preparePi } from "./pi-packages.mjs";

try {
  preparePi(process.cwd());
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
