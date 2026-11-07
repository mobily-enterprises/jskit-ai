import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { testConcurrency } from "@jskit-ai/jskit-catalog/test-budget";

// JSKIT's lint, in as many ESLint worker threads as the machine's test budget allows (V64_TEST_CONCURRENCY, otherwise
// half of the machine, as jskit test runs test files). One thread took 78 s on an 8-thread test host; two took 48 s.
// Extra arguments go to ESLint, such as --fix.
const require = createRequire(import.meta.url);
const manifest = require.resolve("eslint/package.json");
const eslint = path.join(path.dirname(manifest), require(manifest).bin.eslint);
const { status } = spawnSync(
  process.execPath,
  [eslint, "packages", "tooling", "scripts", "--max-warnings=0", `--concurrency=${testConcurrency()}`, ...process.argv.slice(2)],
  { stdio: "inherit" }
);
process.exit(status ?? 1);
