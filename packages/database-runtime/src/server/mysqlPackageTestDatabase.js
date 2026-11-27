// A package data test's own MySQL or MariaDB database (createPackageTestKnex() on a mysql2 run in testDatabases.js):
// the first of TEST_DB_NAME's 26 lettered copies, `<TEST_DB_NAME>_a` to `_z`, that no other test holds. Never a name
// of its own, which a database user granted only its test database's copies, by name as a managed host may grant them
// or as `<TEST_DB_NAME>\__` (an underscore and one character) as Vibe64's database guide does, may not create; and
// never the numbered copies (`_1`, `_2`, ...), which a `jskit test --databases` run restores at its start and drops at
// its end whoever is using them. A test claims its copy with a lock on the database server named after the copy, held
// by a session of its own for as long as the test runs, so tests running at once, in this run or in another tree's on
// the same server, never share one, and a process that dies gives its claim up with its session. An application's own
// test fixture that claims these copies takes the same locks, so the two never meet. The claimed copy is recreated
// empty, so whatever an interrupted test left in it never reaches the next. With all 26 held a claim waits, then
// refuses, and never makes a 27th name. In a file that `jskit test --databases` gave a numbered copy of the run's
// designated database (testDatabaseFile.js names it), the copies are the designated database's: a numbered copy's own
// would be names no grant covers.
import { setTimeout as delay } from "node:timers/promises";
import { resolveKnexConnectionFromEnvironment } from "../shared/databaseConnection.js";

// A MySQL or MariaDB test database's character set and collation: the run's databases and a package test's own.
const MYSQL_DATABASE_OPTIONS = "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci";
// The run's designated test database, in a file that `jskit test --databases` gave one of its numbered copies.
const DESIGNATED_TEST_DATABASE = "JSKIT_DESIGNATED_TEST_DB_NAME";
const COPY_LETTERS = "abcdefghijklmnopqrstuvwxyz";
const CLAIM_TIMEOUT_MS = 60_000;
const CLAIM_RETRY_MS = 250;
// The server refuses the database user this copy: the copies after it are not granted either.
const COPY_REFUSED = new Set(["ER_DBACCESS_DENIED_ERROR", "ER_SPECIFIC_ACCESS_DENIED_ERROR"]);

/** The database whose lettered copies a test claims: TEST_DB_NAME, or the run's designated one it is a copy of. */
function copiesOf(environment, testDatabase) {
  const designated = String(environment[DESIGNATED_TEST_DATABASE] || "").trim();
  const numbered = designated && testDatabase.startsWith(`${designated}_`) && /^[0-9]+$/u.test(testDatabase.slice(designated.length + 1));
  return numbered ? designated : testDatabase;
}

/** The 26 lettered copies of `base`, `<base>_a` to `_z`, in the order a test claims them. */
function letteredCopies(base) {
  return [...COPY_LETTERS].map((letter) => `${base}_${letter}`);
}

/** The 26 names a test claims, and the grant that gives a database user all of them. */
function grantHint(base) {
  const pattern = `${base.replace(/[\\_%]/gu, "\\$&")}\\__`;
  return `A package data test on MySQL or MariaDB claims only TEST_DB_NAME's 26 lettered copies, ${base}_a to ${base}_z: ` +
    `grant DB_USER all privileges on each by name, or on all at once as \`${pattern}\`.*.`;
}

/**
 * Claims the first lettered copy of `base` no other session holds, recreated empty, and answers its name; the lock on
 * it stays with the session `on` runs its statements on. Waits up to `timeoutMs` for a copy to come free.
 * @param {(sql: string, bindings?: unknown[]) => Promise<any>} on Runs a statement on the claiming session.
 * @param {string} base
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<string>}
 */
async function claimLetteredCopy(on, base, { timeoutMs = CLAIM_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  let granted = letteredCopies(base);
  for (;;) {
    for (const [index, database] of granted.entries()) {
      const [[{ claimed }]] = await on("SELECT GET_LOCK(?, 0) AS claimed", [database]);
      if (Number(claimed) !== 1) continue;
      try {
        await on("DROP DATABASE IF EXISTS ??", [database]);
        await on(`CREATE DATABASE ?? ${MYSQL_DATABASE_OPTIONS}`, [database]);
        return database;
      } catch (error) {
        await on("SELECT RELEASE_LOCK(?)", [database]);
        if (!COPY_REFUSED.has(error.code)) throw error;
        if (index === 0) throw new Error(`DB_USER may not create ${database}. ${grantHint(base)}`, { cause: error });
        // This copy and those after it are not granted: wait for one before it.
        granted = granted.slice(0, index);
        break;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`All ${granted.length} lettered copies of ${base} DB_USER may create (${granted[0]} to ` +
        `${granted.at(-1)}) are held by other tests, and none came free within ${timeoutMs / 1000}s: let some finish, ` +
        `or run fewer at once. ${grantHint(base)}`);
    }
    await delay(CLAIM_RETRY_MS);
  }
}

/**
 * createPackageTestKnex() on a mysql2 run: a Knex on the test's claimed copy (see the top), with an application's
 * mysql2 connection settings and `pool`; after the test the Knex is destroyed, the copy dropped and the claim given
 * up. Its sessions run with MariaDB's innodb_snapshot_isolation off, the MariaDB 11.4 default (11.6 turns it on), so
 * a test reads InnoDB's REPEATABLE READ as every supported server does by default; MySQL has no such setting.
 * @param {{ after(cleanup: () => unknown): unknown }} context
 * @param {{ knexFactory: Function, environment: Record<string, unknown>, testDatabase: string, pool: object }} options
 * @returns {Promise<import("knex").Knex>}
 */
async function createMysqlPackageTestKnex(context, { knexFactory, environment, testDatabase, pool }) {
  const server = { ...resolveKnexConnectionFromEnvironment(environment, { client: "mysql2", defaultPort: 3306 }), database: undefined };
  const admin = knexFactory({ client: "mysql2", connection: server, pool: { min: 0, max: 1 } });
  let session;
  const on = (sql, bindings = []) => admin.raw(sql, bindings).connection(session);
  const giveUp = async () => {
    try {
      if (session) await admin.client.releaseConnection(session);
    } finally {
      // Its session ends, and the claim with it.
      await admin.destroy();
    }
  };
  let database;
  let isolation;
  try {
    session = await admin.client.acquireConnection();
    [isolation] = await on("SHOW VARIABLES LIKE 'innodb_snapshot_isolation'");
    database = await claimLetteredCopy(on, copiesOf(environment, testDatabase));
  } catch (error) {
    await giveUp();
    throw error;
  }
  const afterCreate = (connection, done) =>
    connection.query("SET SESSION innodb_snapshot_isolation = OFF", (error) => done(error, connection));
  const testPool = { ...pool, ...(isolation.length > 0 && { afterCreate }) };
  const knex = knexFactory({ client: "mysql2", connection: { ...server, database }, pool: testPool });
  context.after(async () => {
    try {
      await knex.destroy();
      await on("DROP DATABASE IF EXISTS ??", [database]);
      await on("SELECT RELEASE_LOCK(?)", [database]);
    } finally {
      await giveUp();
    }
  });
  return knex;
}

export { DESIGNATED_TEST_DATABASE, MYSQL_DATABASE_OPTIONS, claimLetteredCopy, createMysqlPackageTestKnex, letteredCopies };
