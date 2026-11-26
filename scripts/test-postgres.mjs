// The package data tests on PostgreSQL: every package's *.postgres.test.js files, and the package test files whose
// data tests take the run's Knex (test:sqlite's selection), on a DB_CLIENT=pg run, where createPackageTestKnex() gives
// each a schema of its own. `npm run verify` runs the packages' tests on MariaDB, where the PostgreSQL ones skip, so
// this is a whole run's PostgreSQL half, and CI's PostgreSQL job. It picks the files itself, so a new one is never
// left out of a list kept by hand.
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { packageTestFiles, runKnexTestFiles } from "./test-sqlite.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const JSKIT_CLI = path.join(ROOT_DIR, "tooling", "jskit-catalog", "scripts", "jskit.mjs");
const POSTGRES_RUN = /\.postgres\.test\.js$/u;

/** The package test files a PostgreSQL run runs, relative to the repository, sorted. */
function postgresTestFiles(rootDir = ROOT_DIR) {
  return [...packageTestFiles((entry) => POSTGRES_RUN.test(entry), rootDir), ...runKnexTestFiles(rootDir)].sort();
}

function main() {
  const { DB_CLIENT, DB_NAME, TEST_DB_NAME } = process.env;
  // The PostgreSQL tests skip off a pg run, and some unless DB_NAME is the test database: a run that would skip them
  // is refused, since data tests never skip.
  if (DB_CLIENT !== "pg" || !TEST_DB_NAME || DB_NAME !== TEST_DB_NAME) {
    throw new Error(
      "test:postgres runs on a PostgreSQL test database: set DB_CLIENT=pg, TEST_DB_NAME, DB_NAME to the same name, " +
      `and DB_HOST, DB_PORT, DB_USER and DB_PASSWORD (DB_CLIENT=${DB_CLIENT || "unset"}, ` +
      `DB_NAME=${DB_NAME || "unset"}, TEST_DB_NAME=${TEST_DB_NAME || "unset"}).`
    );
  }
  const files = postgresTestFiles();
  process.stderr.write(`test:postgres: ${files.length} package test file(s) on PostgreSQL (TEST_DB_NAME=${TEST_DB_NAME}).\n`);
  const run = spawnSync(process.execPath, [JSKIT_CLI, "test", ...files], { cwd: ROOT_DIR, stdio: "inherit" });
  process.exitCode = run.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main();
}

export { postgresTestFiles };
