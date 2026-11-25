// How a `jskit test --databases` run (testDatabaseRun() in testDatabases.js) ends: it drops the numbered copies of
// TEST_DB_NAME it made, `<name>_1`, `_2`, ..., which the next run makes afresh from the snapshot anyway, however the run
// ends (its tests passed, failed or were interrupted, or its check failed before the first file). TEST_DB_NAME itself
// and the snapshot stay (PostgreSQL's `<name>_snapshot` database, MySQL's and MariaDB's file), so a later run in the same
// tree restores them instead of replaying the migrations. Only the copies the run made are dropped, one at a time, and
// none a session is connected to, such as another run's.
import { rmSync } from "node:fs";
import { loadKnexFactory } from "./knexFactory.js";

// The database a PostgreSQL connection uses to create, drop and copy the test databases.
const POSTGRES_MAINTENANCE_DATABASE = "postgres";
// PostgreSQL's object_in_use: DROP DATABASE refuses a database another session is connected to.
const POSTGRES_OBJECT_IN_USE = "55006";
// How long a drop on MySQL or MariaDB waits for a session's metadata lock before it gives up (ER_LOCK_WAIT_TIMEOUT).
const MYSQL_LOCK_WAIT_SECONDS = 5;
// The sessions connected to a database, as each driver answers them; the drop's own connection uses none of the copies.
// PostgreSQL's client sessions only: DROP DATABASE stops an autovacuum worker itself. MySQL and MariaDB list a database
// user only its own sessions unless it has the PROCESS privilege.
const SESSIONS = Object.freeze({
  pg: { sql: "SELECT pid FROM pg_stat_activity WHERE datname = ? AND backend_type = 'client backend'", rows: (result) => result.rows },
  mysql2: { sql: "SELECT ID FROM information_schema.PROCESSLIST WHERE DB = ?", rows: ([rows]) => rows }
});

/** Drops `database` through `knex`, a connection to its server; false when a session is connected to it. */
async function dropUnlessInUse(knex, client, database) {
  const { sql, rows } = SESSIONS[client];
  if (rows(await knex.raw(sql, [database])).length > 0) return false;
  try {
    await knex.raw("DROP DATABASE IF EXISTS ??", [database]);
    return true;
  } catch (error) {
    // A session connected since the check: PostgreSQL refuses the drop.
    if (error.code === POSTGRES_OBJECT_IN_USE) return false;
    throw error;
  }
}

/**
 * Drops the run's numbered copies of TEST_DB_NAME: every database of `databases` after the first, TEST_DB_NAME itself,
 * as testDatabaseRun() prepared them. It answers what it did, for the run's report, or "" when the run made no copies,
 * and never throws: a copy it did not drop is named with the reason, and the run's result stays its tests'.
 * @param {{ client: "mysql2" | "pg", connection: object, pool?: object }} knexConfig
 * @param {string[]} databases
 * @returns {Promise<string>}
 */
async function dropTestDatabaseCopies(knexConfig, databases) {
  const { client } = knexConfig;
  const copies = databases.slice(1);
  if (copies.length < 1) return "";
  const kept = [];
  let knex;
  try {
    knex = loadKnexFactory()({
      ...knexConfig,
      connection: { ...knexConfig.connection, database: client === "pg" ? POSTGRES_MAINTENANCE_DATABASE : undefined },
      pool: { ...knexConfig.pool, min: 0, max: 1 }
    });
    if (client === "mysql2") await knex.raw(`SET SESSION lock_wait_timeout = ${MYSQL_LOCK_WAIT_SECONDS}`);
    for (const copy of copies) {
      try {
        if (!(await dropUnlessInUse(knex, client, copy))) kept.push(`${copy}, which a session is connected to`);
      } catch (error) {
        kept.push(`${copy} (${error.code || error.message})`);
      }
    }
  } catch (error) {
    return `could not drop the run's ${copies.length} numbered test database(s): ${error.code || error.message}`;
  } finally {
    await knex?.destroy();
  }
  if (kept.length < 1) return `dropped the run's ${copies.length} numbered test database(s)`;
  return `dropped ${copies.length - kept.length} of the run's ${copies.length} numbered test database(s); kept ${kept.join("; ")}`;
}

/**
 * Ends a run: removes its settings directory, at once, then drops its copies.
 * @param {{ client: "mysql2" | "pg", connection: object, pool?: object }} knexConfig
 * @param {string[]} databases
 * @param {string} directory
 * @returns {Promise<string>} what dropTestDatabaseCopies() did.
 */
function endTestDatabaseRun(knexConfig, databases, directory) {
  rmSync(directory, { recursive: true, force: true });
  return dropTestDatabaseCopies(knexConfig, databases);
}

/**
 * Runs `work`, a step of a run's start after its databases were made; when it throws, the run's copies are dropped
 * before the error goes on, since the run ends there.
 * @template T
 * @param {{ client: "mysql2" | "pg", connection: object, pool?: object }} knexConfig
 * @param {string[]} databases
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
async function dropCopiesIfThrows(knexConfig, databases, work) {
  try {
    return await work();
  } catch (error) {
    await dropTestDatabaseCopies(knexConfig, databases);
    throw error;
  }
}

export { POSTGRES_MAINTENANCE_DATABASE, dropCopiesIfThrows, dropTestDatabaseCopies, endTestDatabaseRun };
