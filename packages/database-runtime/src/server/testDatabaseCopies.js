// How a run's numbered copies of its test database, `<name>_1`, `_2`, ..., which the next run makes afresh from the
// snapshot anyway, are dropped however the run ends. A `jskit test --databases` run (testDatabaseRun() in
// testDatabases.js) drops those of TEST_DB_NAME when its tests passed, failed or were interrupted, or its check failed
// before the first file; a browser run's launcher (jskit-catalog's browser-test-servers.mjs) drops those of
// BROWSER_TEST_DB_NAME its prepare module made when it stops; and prepareTestDatabases() drops those it made when it
// throws. The designated database itself and the snapshot stay (PostgreSQL's `<name>_snapshot` database, MySQL's and
// MariaDB's file), so a later run in the same tree restores them instead of replaying the migrations. A run ends by
// dropping only the copies it made, one at a time, and none a session is connected to, such as another run's.
//
// A run that never reached its end (killed with SIGKILL, stopped at a command's time limit, on a machine that went down)
// leaves its copies. So each run starts by dropping the numbered copies of its database it will not make itself,
// `<name>_<count>` and up, which an earlier run left (dropLeftTestDatabaseCopies): none a session is connected to, and
// only names JSKIT gives a copy (`<name>_1`, `_2`, ...; never `<name>_snapshot`, or a project's own lettered fixture
// copies such as `<name>_a`). The copies it makes itself are made afresh anyway. Two runs at once on one database name
// are not supported: they would share those copies.
import { rmSync } from "node:fs";
import { loadKnexFactory } from "./knexFactory.js";

// The database a PostgreSQL connection uses to create, drop and copy the test databases.
const POSTGRES_MAINTENANCE_DATABASE = "postgres";
// PostgreSQL's object_in_use: DROP DATABASE refuses a database another session is connected to.
const POSTGRES_OBJECT_IN_USE = "55006";
// How long a drop on MySQL or MariaDB waits for a session's metadata lock before it gives up (ER_LOCK_WAIT_TIMEOUT).
const MYSQL_LOCK_WAIT_SECONDS = 5;
// The sets of copies prepareTestDatabases() made in this process and not yet dropped, each with its drop. A browser run's
// launcher loads the app's own copy of this package through the app's prepare module, so it finds them under this
// global key rather than by importing it.
const PREPARED_COPIES = Symbol.for("@jskit-ai/database-runtime/preparedTestDatabaseCopies");
// The databases a server lists: PostgreSQL's every one, MySQL's and MariaDB's those the user has a privilege on.
const DATABASES = Object.freeze({
  pg: { sql: "SELECT datname AS name FROM pg_database", rows: (result) => result.rows },
  mysql2: { sql: "SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA", rows: ([rows]) => rows }
});
// The sessions connected to a database, as each driver answers them; the drop's own connection uses none of the copies.
// PostgreSQL's client sessions only: DROP DATABASE stops an autovacuum worker itself. MySQL and MariaDB list a database
// user only its own sessions unless it has the PROCESS privilege.
const SESSIONS = Object.freeze({
  pg: { sql: "SELECT pid FROM pg_stat_activity WHERE datname = ? AND backend_type = 'client backend'", rows: (result) => result.rows },
  mysql2: { sql: "SELECT ID FROM information_schema.PROCESSLIST WHERE DB = ?", rows: ([rows]) => rows }
});

/**
 * The databases for `count` test files or workers at once: `name`, then its numbered copies.
 * @param {string} name
 * @param {number} count
 */
function testDatabaseNames(name, count) {
  return Array.from({ length: count }, (_, index) => (index ? `${name}_${index}` : name));
}

/** The sets of copies this process made and has not dropped, by their `databases` list. */
function preparedCopies() {
  globalThis[PREPARED_COPIES] ??= new Map();
  return globalThis[PREPARED_COPIES];
}

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
  preparedCopies().delete(databases);
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
 * Drops the numbered copies of `name` an earlier run left, `<name>_<count>` and up: every one on the server that no
 * session is connected to. It answers what it did, for the run's summary, or "" when it found none, and never throws:
 * a copy it could not drop is named with the reason, and the run goes on.
 * @param {{ client: "mysql2" | "pg", connection: object, pool?: object }} knexConfig
 * @param {string} name the run's designated database (letters, digits and _ only)
 * @param {number} count how many databases the run makes: `name`, then `<name>_1` to `<name>_<count - 1>`
 * @returns {Promise<string>}
 */
async function dropLeftTestDatabaseCopies(knexConfig, name, count) {
  const { client } = knexConfig;
  const copy = new RegExp(`^${name}_([1-9]\\d*)$`, "u");
  const dropped = [];
  const kept = [];
  let knex;
  try {
    knex = loadKnexFactory()({
      ...knexConfig,
      connection: { ...knexConfig.connection, database: client === "pg" ? POSTGRES_MAINTENANCE_DATABASE : undefined },
      pool: { ...knexConfig.pool, min: 0, max: 1 }
    });
    if (client === "mysql2") await knex.raw(`SET SESSION lock_wait_timeout = ${MYSQL_LOCK_WAIT_SECONDS}`);
    const { sql, rows } = DATABASES[client];
    const left = rows(await knex.raw(sql)).map((row) => String(row.name))
      .filter((database) => Number(copy.exec(database)?.[1]) >= count).sort();
    for (const database of left) {
      try {
        if (await dropUnlessInUse(knex, client, database)) dropped.push(database);
        else kept.push(`${database}, which a session is connected to`);
      } catch (error) {
        kept.push(`${database} (${error.code || error.message})`);
      }
    }
  } catch (error) {
    return `could not drop the numbered test database(s) earlier runs left: ${error.code || error.message}`;
  } finally {
    await knex?.destroy();
  }
  if (dropped.length + kept.length < 1) return "";
  return [
    dropped.length ? `dropped ${dropped.length} numbered test database(s) earlier runs left (${dropped.join(", ")})` : "",
    kept.length ? `kept ${kept.join("; ")}` : ""
  ].filter(Boolean).join("; ");
}

/**
 * Keeps the numbered copies among `databases` for this process's end, under the key a browser run's launcher drops
 * them by once its servers have stopped; dropTestDatabaseCopies() of the same list drops them once.
 * @param {{ client: "mysql2" | "pg", connection: object, pool?: object }} knexConfig
 * @param {string[]} databases
 * @returns {string[]} `databases`.
 */
function rememberTestDatabaseCopies(knexConfig, databases) {
  if (databases.length > 1) preparedCopies().set(databases, () => dropTestDatabaseCopies(knexConfig, databases));
  return databases;
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
 * Runs `work`, a step of a run's start that makes, fills or checks `databases`; when it throws, the copies among them
 * that exist are dropped before the error goes on, since the run ends there.
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

export {
  POSTGRES_MAINTENANCE_DATABASE,
  dropCopiesIfThrows,
  dropLeftTestDatabaseCopies,
  dropTestDatabaseCopies,
  endTestDatabaseRun,
  rememberTestDatabaseCopies,
  testDatabaseNames
};
