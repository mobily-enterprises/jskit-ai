// Preloaded (`--import`) by `jskit test --databases` into every test file's process. When the run has disposable
// databases (JSKIT_TEST_DATABASES names the run's directory, from testDatabaseRun() in testDatabases.js), the file takes
// one no other file is using, for as long as it runs, as both DB_NAME and TEST_DB_NAME, with the connection it was
// restored on (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD): it never reaches the developer's database. Every file starts
// from the snapshot, rows included: a database an earlier file of the run used is restored before the next file takes
// it, since that file may have written rows, or changed tables or the migration ledger (a migration test).
//
// The directory holds the run's settings (only this user may read them: they include the connection password, which
// reaches only the test files' own processes), a lock file per database holding its user's process id, and a marker
// per database an earlier file used. The runner's own `node --test` process and every worker
// thread a test starts load this module too, since they inherit --import: there it does nothing (and loads nothing
// more), and nothing a file starts takes a database of its own.
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { isMainThread } from "node:worker_threads";

const CLAIM_TIMEOUT_MS = 60_000;

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Takes the first free database, and answers it and whether an earlier file of the run used it; a lock left by a
 * process that died without releasing it is taken over.
 */
async function claimDatabase(directory, databases) {
  const deadline = Date.now() + CLAIM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    for (const [index, database] of databases.entries()) {
      const lock = path.join(directory, `${index}.lock`);
      try {
        const descriptor = openSync(lock, "wx");
        writeSync(descriptor, String(process.pid));
        closeSync(descriptor);
        process.once("exit", () => rmSync(lock, { force: true }));
        const marker = path.join(directory, `${index}.used`);
        const used = existsSync(marker);
        if (!used) writeFileSync(marker, "");
        return { database, used };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      let owner = 0;
      try {
        owner = Number.parseInt(readFileSync(lock, "utf8"), 10);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (owner && !isRunning(owner)) rmSync(lock, { force: true });
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`No test database came free within ${CLAIM_TIMEOUT_MS / 1000}s.`);
}

const directory = process.env.JSKIT_TEST_DATABASES;
if (isMainThread && process.env.NODE_TEST_CONTEXT && directory) {
  delete process.env.JSKIT_TEST_DATABASES;
  const { RUN_SETTINGS_FILE, restoreTestDatabase } = await import("./testDatabases.js");
  const { databases, snapshot, knexConfig } = JSON.parse(readFileSync(path.join(directory, RUN_SETTINGS_FILE), "utf8"));
  // The run restored every database as it started; one an earlier file used holds what that file left.
  const { database, used } = await claimDatabase(directory, databases);
  if (used) {
    await restoreTestDatabase(knexConfig, database, snapshot);
  }
  const { host, port, user, password } = knexConfig.connection;
  Object.assign(process.env, {
    DB_HOST: String(host),
    DB_PORT: String(port),
    DB_USER: String(user),
    DB_PASSWORD: String(password ?? ""),
    DB_NAME: database,
    TEST_DB_NAME: database
  });
}
