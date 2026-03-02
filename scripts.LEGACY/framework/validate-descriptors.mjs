#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runCli } from "../../packages/tooling/jskit/src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const exitCode = await runCli(["lint-descriptors"], {
  cwd: repoRoot,
  stdout: process.stdout,
  stderr: process.stderr
});
process.exit(exitCode);
