// The package data tests on SQLite. Each package data test takes its Knex from database-runtime's
// createPackageTestKnex() with the run's environment: on a DB_CLIENT=mysql2 or pg run, a MySQL, MariaDB or PostgreSQL
// database or schema of its own, and SQLite in memory otherwise. `npm run verify` runs the packages' tests on a
// DB_CLIENT=mysql2 run, and `npm run test:postgres` runs these files on pg, so this runs those test files (none of the
// MySQL, PostgreSQL or browser ones) again with DB_CLIENT unset, which no other run does: their SQLite cases, and
// SQLite's half of each dialect's own, run here.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const JSKIT_CLI = path.join(ROOT_DIR, "tooling", "jskit-catalog", "scripts", "jskit.mjs");
// The files a dialect of its own runs, or a browser.
const OTHER_RUNS = /\.(?:mysql|postgres|browser)\.test\.js$/u;
// A data test that takes its Knex for the run's own DB_CLIENT.
const RUN_KNEX = /createPackageTestKnex\([^)]*environment: process\.env/u;

/** The packages' test files (`packages/<name>/test/*.test.js`) that keep(fileName, file) keeps, relative to the repository, sorted. */
function packageTestFiles(keep, rootDir = ROOT_DIR) {
  const files = [];
  for (const name of readdirSync(path.join(rootDir, "packages")).sort()) {
    const directory = path.join("packages", name, "test");
    let entries;
    try {
      entries = readdirSync(path.join(rootDir, directory)).sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      const file = path.join(directory, entry);
      if (entry.endsWith(".test.js") && keep(entry, file)) files.push(file);
    }
  }
  return files;
}

/** The packages' test files whose data tests take the run's Knex, relative to the repository, sorted. */
function runKnexTestFiles(rootDir = ROOT_DIR) {
  return packageTestFiles((entry, file) => !OTHER_RUNS.test(entry) && RUN_KNEX.test(readFileSync(path.join(rootDir, file), "utf8")), rootDir);
}

function main() {
  const files = runKnexTestFiles();
  if (files.length < 1) throw new Error("test:sqlite found no package data test file that takes createPackageTestKnex()'s Knex.");
  process.stderr.write(`test:sqlite: ${files.length} package test file(s) on SQLite, DB_CLIENT unset.\n`);
  const run = spawnSync(process.execPath, [JSKIT_CLI, "test", ...files], {
    cwd: ROOT_DIR,
    env: { ...process.env, DB_CLIENT: "" },
    stdio: "inherit"
  });
  process.exitCode = run.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main();
}

export { packageTestFiles, runKnexTestFiles };
