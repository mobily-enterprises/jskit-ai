import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

// `jskit test --databases`: each test file running at once gets a database of its own, a copy of TEST_DB_NAME restored
// from a schema snapshot, from the application's installed @jskit-ai/database-runtime and its knexfile.js, which loads
// .env and fixes the dialect. JSKIT's catalog itself depends on no database package. What the knexfile loads into the
// environment is read for the databases only: the test files get the environment `jskit test` was given, plus their
// own database and its connection (DB_NAME, TEST_DB_NAME, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD).
const OPTION = "--databases";
const KNEXFILES = Object.freeze(["knexfile.js", "knexfile.mjs", "knexfile.cjs"]);
const TEST_DATABASES = "@jskit-ai/database-runtime/server/testDatabases";

/** Runs `load` and puts process.env back as it was, returning what `load` returned and the environment it saw. */
async function withOwnEnvironment(load) {
  const before = { ...process.env };
  try {
    const result = await load();
    return { result, environment: { ...process.env } };
  } finally {
    for (const name of Object.keys(process.env)) if (!Object.hasOwn(before, name)) delete process.env[name];
    Object.assign(process.env, before);
  }
}

/**
 * The run's databases for `count` files at once, or one file at a time on the connected database.
 * @param {number} count at most the run's test budget, and no more than its test files
 * @param {string} [cwd]
 * @returns {Promise<{ concurrency: number, env: Record<string, string>, preload: string, summary: string, cleanup(): void }>}
 */
async function testDatabaseRunFor(count, cwd = process.cwd()) {
  const knexfile = KNEXFILES.map((name) => path.join(cwd, name)).find((file) => existsSync(file));
  if (!knexfile) throw new Error(`jskit test ${OPTION} reads the application's knexfile.js, and ${cwd} has none.`);
  let testDatabases;
  try {
    testDatabases = createRequire(path.join(cwd, "package.json")).resolve(TEST_DATABASES);
  } catch {
    throw new Error(`jskit test ${OPTION} needs ${TEST_DATABASES}; install the application's JSKIT database driver.`);
  }
  const { result: knexConfig, environment } = await withOwnEnvironment(async () =>
    (await import(pathToFileURL(knexfile).href)).default);
  const { testDatabaseRun } = await import(pathToFileURL(testDatabases).href);
  return testDatabaseRun({ knexConfig, environment, count, appRoot: cwd });
}

export { OPTION as DATABASES_OPTION, testDatabaseRunFor };
