// The disposable databases of a test run, and the stored schema snapshots they are restored from.
//
// A run gets one database per test file or browser worker running at once: the designated one (TEST_DB_NAME for Node
// test files, BROWSER_TEST_DB_NAME for browser workers), then copies named after it (`<name>_1`, `_2`, ...) where the
// database user may create them. Each starts from a snapshot of the schema the migrations build, with the rows they
// write, instead of replaying every migration. A snapshot is taken once from a real replay into the designated
// database, keyed by the dialect, the names and contents of the migrations and the application's package-lock.json
// (a package upgrade can change what its migrations' helpers build), so changing, adding or reordering a migration, or
// installing other packages, takes a new one. An application whose schema does not come from its migrations alone, such
// as one whose migrations start from a baseline schema file, gives its own `schema.build` and the files it reads, which
// join the key:
//
// - MySQL and MariaDB: each table's SHOW CREATE TABLE and its rows, in a file under
//   `node_modules/.cache/jskit-test-databases/` named after the key and the server's version; a restore replaces only
//   the tables that differ from it;
// - PostgreSQL: a prepared database, `<name>_snapshot`, that every copy is created from with
//   CREATE DATABASE ... TEMPLATE (STRATEGY FILE_COPY from PostgreSQL 15).
//
// testDatabaseSnapshots.js holds each dialect's snapshot and restore.
//
// The database the application connects to (DB_NAME, the one DATABASE_URL names, the Knex configuration's own), and the
// Staging and Production databases an application names on that server (STAGING_DB_NAME, PRODUCTION_DB_NAME), are never
// touched. A preparation refuses to start while a variable JSKIT no longer reads is set, PROD_DB_NAME among them
// (`assertNoRetiredVariables`). Two runs at once need different database names, as before.
//
// A database test that guards a path's cost counts the statements the path sends with countQueries(), or, for a route
// of a server the test booted, countRuntimeQueries(); expectFlatQueries() in @jskit-ai/resource-runtime/test compares
// those counts at a few rows and at many. A data test never skips: requireTestDatabase() fails it when TEST_DB_NAME is
// not set.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import diagnosticsChannel from "node:diagnostics_channel";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { assertNoRetiredVariables } from "@jskit-ai/kernel/server/runtime/appEnvironment";
import { appEnvironment, isStagingOrProduction } from "@jskit-ai/kernel/shared/support/appEnvironment";
import { parseDatabaseUrl, resolveKnexConnectionFromEnvironment, resolveKnexPool } from "../shared/databaseConnection.js";
import { detectDialectFromClient } from "../shared/dialect.js";
import { RUNTIME_QUERY_CHANNEL } from "./database.js";
import { loadKnexFactory } from "./knexFactory.js";
import { createMysqlPackageTestKnex, letteredCopies } from "./mysqlPackageTestDatabase.js";
import {
  POSTGRES_MAINTENANCE_DATABASE,
  dropCopiesIfThrows,
  dropLeftTestDatabaseCopies,
  endTestDatabaseRun,
  rememberTestDatabaseCopies,
  testDatabaseNames
} from "./testDatabaseCopies.js";
import {
  DIALECTS,
  POSTGRES_INSUFFICIENT_PRIVILEGE,
  dialectOf,
  ledgerOf,
  settleAll,
  withKnex
} from "./testDatabaseSnapshots.js";

// Room for a `_snapshot` or copy suffix within MySQL's 64 and PostgreSQL's 63 characters.
const DISPOSABLE_NAME = /^[A-Za-z0-9_]{1,48}$/u;
const TEST_DATABASE_VARIABLES = Object.freeze(["TEST_DB_NAME", "BROWSER_TEST_DB_NAME"]);
// The Staging and Production databases an application names on a server it shares with its test databases.
const PROTECTED_DATABASE_VARIABLES = Object.freeze(["STAGING_DB_NAME", "PRODUCTION_DB_NAME"]);
// A database or table the user may not use (not a wrong password, which fails the run).
const MYSQL_REFUSED_PRIVILEGE = new Set(["ER_DBACCESS_DENIED_ERROR", "ER_SPECIFIC_ACCESS_DENIED_ERROR", "ER_TABLEACCESS_DENIED_ERROR"]);
// The run's settings, connection password included, in a file only this user can read; the environment names its
// directory only.
const RUN_SETTINGS_FILE = "settings.json";
// The run's settings file, in the environment of each file of a `jskit test --databases` run (testDatabaseFile.js),
// for claimTestDatabaseCopy().
const RUN_SETTINGS_VARIABLE = "JSKIT_TEST_DATABASE_SETTINGS";
// How long a claim of a lettered copy waits for one to come free.
const COPY_CLAIM_TIMEOUT_MS = 60_000;
const TEST_DATABASE_FILE = fileURLToPath(new URL("./testDatabaseFile.js", import.meta.url));
const LOCKFILE = "package-lock.json";

/**
 * @typedef {object} TestDatabaseSchema How a new snapshot's schema is built when the migrations alone do not build it.
 * @property {string[]} [files] Every file the build reads, its own module included, relative to the application root:
 *   their contents join the snapshot key, so changing one takes a new snapshot.
 * @property {(knex: import("knex").Knex) => Promise<unknown>} [build] Builds the schema, and any rows every test
 *   database starts with, in the empty database `knex` connects to, instead of `knex.migrate.latest()`: for example a
 *   baseline schema file, then the migrations.
 */

const folded = (value) => String(value ?? "").trim().toLowerCase();
const milliseconds = (since) => Math.round(performance.now() - since);

/** The database the application's environment connects to: DB_NAME, else the one DATABASE_URL names. */
function connectedDatabaseName(environment) {
  return String(environment.DB_NAME || "").trim() ||
    parseDatabaseUrl(environment.DATABASE_URL, { allowEmpty: true })?.database || "";
}

/**
 * The disposable database `variable` names, checked with its first `count - 1` copies: never while a variable JSKIT no
 * longer reads is set (`assertNoRetiredVariables`, PROD_DB_NAME among them), never in staging or production (APP_ENV),
 * never the application's database (DB_NAME, DATABASE_URL's and `connected`, the one its Knex configuration names) or
 * its Staging or Production database (STAGING_DB_NAME, PRODUCTION_DB_NAME), and never the other test database or its
 * copies.
 * @param {Record<string, string | undefined>} environment
 * @param {"TEST_DB_NAME" | "BROWSER_TEST_DB_NAME"} variable
 * @param {number} [count]
 * @param {{ connected?: string }} [options]
 */
function requireDisposableDatabase(environment, variable, count = 1, { connected = "" } = {}) {
  assertNoRetiredVariables(environment);
  if (isStagingOrProduction(environment)) {
    throw new Error(`Test databases are never prepared when APP_ENV is ${appEnvironment(environment)}.`);
  }
  const name = String(environment[variable] || "").trim();
  if (!DISPOSABLE_NAME.test(name)) {
    throw new Error(`${variable} must name a disposable test database: letters, digits and _, at most 48 characters.`);
  }
  const application = [
    connectedDatabaseName(environment),
    environment.DB_NAME,
    ...PROTECTED_DATABASE_VARIABLES.map((protectedName) => environment[protectedName]),
    connected
  ].map(folded).filter(Boolean);
  const others = TEST_DATABASE_VARIABLES.filter((other) => other !== variable)
    .map((other) => folded(environment[other])).filter(Boolean);
  // `copy` is `original` or one of its numbered copies, whatever the count of either run.
  const isCopy = (copy, original) => copy === original ||
    (copy.startsWith(`${original}_`) && /^\d+$/u.test(copy.slice(original.length + 1)));
  for (const candidate of testDatabaseNames(name, count).map(folded)) {
    if (application.includes(candidate)) {
      throw new Error(`${variable} and its copies must differ from the application's DB_NAME, DATABASE_URL, ` +
        `STAGING_DB_NAME and PRODUCTION_DB_NAME (${candidate}).`);
    }
  }
  for (const other of others) {
    if (isCopy(folded(name), other) || isCopy(other, folded(name))) {
      throw new Error(`${variable} and its copies must differ from the other test database and its copies (${other}).`);
    }
  }
  return name;
}

/**
 * Every migration Knex applies, in its order, and the key of the schema they build: a digest of the dialect, of each
 * migration's name and contents, of each of `schemaFiles` (a schema build's own files) and of the application's
 * package-lock.json. A migration's own file does not show a change in a helper it imports from an installed package;
 * the lockfile does, when that package is upgraded.
 * @param {{ client: string, connection: object, migrations?: object }} knexConfig
 * @param {{ appRoot?: string, schemaFiles?: string[] }} [options] `schemaFiles` are relative to `appRoot`.
 * @returns {Promise<{ key: string, migrations: string[] }>}
 */
async function testDatabaseSnapshotKey(knexConfig, { appRoot = process.cwd(), schemaFiles = [] } = {}) {
  // Without a connection, Knex lists the migrations without loading the database driver or connecting.
  const knex = loadKnexFactory()({ client: knexConfig.client, migrations: knexConfig.migrations });
  try {
    const { migrationSource: source, loadExtensions } = knex.migrate.config;
    const hash = createHash("sha256").update(`${knexConfig.client}\n`);
    const migrations = [];
    for (const migration of await source.getMigrations(loadExtensions)) {
      const name = source.getMigrationName(migration);
      migrations.push(name);
      hash.update(`${name}\0`);
      hash.update(readFileSync(path.join(migration.directory, migration.file)));
    }
    for (const file of schemaFiles) {
      hash.update(`\0${file}\0`);
      hash.update(readFileSync(path.resolve(appRoot, file)));
    }
    const lockfile = path.join(path.resolve(appRoot), LOCKFILE);
    hash.update(`\0${LOCKFILE}\0`);
    if (existsSync(lockfile)) hash.update(readFileSync(lockfile));
    return { key: hash.digest("hex").slice(0, 32), migrations };
  } finally {
    await knex.destroy();
  }
}

/**
 * Prepares the disposable databases for up to `count` test files or browser workers at once, each holding the current
 * migrations' schema afresh, then the seed's rows when given: the database `variable` names, then the numbered copies
 * the database user may create; `shortfall` names the first it may not. It first drops the numbered copies an earlier
 * run that never reached its end left and this one will not make, none a session is connected to
 * (dropLeftTestDatabaseCopies()). A throw drops the copies made so far; the process keeps those it returns, which a
 * browser run's launcher drops when it stops (testDatabaseCopies.js).
 * @param {object} options
 * @param {{ client: string, connection: object, migrations?: object }} options.knexConfig The application's Knex
 *   migration configuration (its knexfile.js), from `createKnexMigrationConfigFromApp()`.
 * @param {Record<string, string | undefined>} options.environment The application's environment, such as `process.env`.
 * @param {"TEST_DB_NAME" | "BROWSER_TEST_DB_NAME"} [options.variable]
 * @param {number} [options.count]
 * @param {(transaction: import("knex").Knex.Transaction) => unknown} [options.seed] Runs in each database, in one
 *   transaction, after its restore.
 * @param {TestDatabaseSchema} [options.schema] How a new snapshot's schema is built, when not by the migrations alone.
 * @param {string} [options.appRoot]
 */
async function prepareTestDatabases({
  knexConfig,
  environment,
  variable = "TEST_DB_NAME",
  count = 1,
  seed,
  schema = {},
  appRoot = process.cwd()
}) {
  const started = performance.now();
  const dialect = dialectOf(knexConfig);
  const name = requireDisposableDatabase(environment, variable, count, { connected: knexConfig.connection.database });
  const root = path.resolve(appRoot);
  const { key, migrations } = await testDatabaseSnapshotKey(knexConfig, { appRoot: root, schemaFiles: schema.files });
  const build = schema.build ?? ((knex) => knex.migrate.latest());
  const snapshot = await dialect.ensureSnapshot(knexConfig, name, key, root, build);
  // An earlier run that never reached its end left its copies; those this run will not make itself go first.
  const swept = await dropLeftTestDatabaseCopies(knexConfig, name, count);
  const restoreStarted = performance.now();
  const names = testDatabaseNames(name, count);
  // A throw drops the copies made so far; the process keeps those it returns for its end (rememberTestDatabaseCopies()).
  const databases = await dropCopiesIfThrows(knexConfig, names, () => dialect.provide(knexConfig, names, snapshot));
  const restoreMs = milliseconds(restoreStarted);
  const seedStarted = performance.now();
  if (seed) await dropCopiesIfThrows(knexConfig, databases, () => settleAll(databases.map((database) =>
    withKnex(knexConfig, database, (knex) => knex.transaction(seed)))));
  const seedMs = milliseconds(seedStarted);
  const { replayed, ...stored } = snapshot;
  const shortfall = databases.length < names.length ? `the database user may not create ${names[databases.length]}` : "";
  return {
    databases: rememberTestDatabaseCopies(knexConfig, databases),
    snapshot: stored,
    shortfall,
    summary: `${databases.length}${shortfall ? ` of ${count}` : ""} test database(s) from ${name} ready in ${milliseconds(started)}ms: ` +
      (replayed && schema.build ? "schema built once for a new snapshot, " : "") +
      (replayed && !schema.build ? `${migrations.length} migrations replayed once for a new snapshot, ` : "") +
      (replayed ? "" : "stored snapshot, ") +
      `restore ${restoreMs}ms${seed ? `, seed ${seedMs}ms` : ""}${swept ? `; ${swept}` : ""}${shortfall ? `; ${shortfall}` : ""}`
  };
}

/**
 * Whether `database` still holds the snapshot's tables and migration ledger, which a test that migrates up or down,
 * or drops tables, changes.
 */
async function matchesSnapshot(knexConfig, database, snapshot) {
  let outline;
  try {
    outline = await dialectOf(knexConfig).outline(knexConfig, database);
  } catch (error) {
    // A test dropped the whole database (MySQL ER_BAD_DB_ERROR, PostgreSQL 3D000): the restore recreates it.
    if (error.code === "ER_BAD_DB_ERROR" || error.code === "3D000") return false;
    throw error;
  }
  const { tables, migrations } = outline;
  return tables.join("\n") === snapshot.tables.join("\n") && migrations.join("\n") === snapshot.migrations.join("\n");
}

/**
 * Restores `database`, which must be disposable, to the snapshot, and answers the tables it replaced, sorted: on MySQL
 * and MariaDB those that differ from the snapshot's, found exactly (a table's definition and AUTO_INCREMENT counter,
 * its triggers, its rows, and tables missing or added), so a file that wrote three tables costs three; on PostgreSQL
 * every table, the database a new copy of the snapshot database, which costs less than finding them.
 * @returns {Promise<string[]>}
 */
async function restoreTestDatabase(knexConfig, database, snapshot) {
  const replaced = await dialectOf(knexConfig).restore(knexConfig, database, snapshot);
  if (!replaced) throw new Error(`The database user may not recreate ${database}.`);
  return replaced;
}

/**
 * The full-history migration proof (`jskit migration-history`). Test runs restore their databases from the stored
 * snapshot and never replay the migrations, so this replays them all, or the application's `schema.build`, from empty
 * into TEST_DB_NAME; requires a second pass of the migrations to find none left; and compares what was built with the
 * snapshot the tests run on: on MySQL and MariaDB as a restore compares, on PostgreSQL each table's columns,
 * constraints, indexes and rows, each view and each sequence; all but the migration ledger's rows, which hold when each
 * migration ran. Passing or failing, it leaves TEST_DB_NAME as the snapshot. It uses no database a test run does not.
 * @param {object} options
 * @param {{ client: string, connection: object, migrations?: object }} options.knexConfig The application's Knex
 *   migration configuration (its knexfile.js).
 * @param {Record<string, string | undefined>} options.environment The application's environment, such as `process.env`.
 * @param {TestDatabaseSchema} [options.schema] How the schema is built, when not by the migrations alone.
 * @param {string} [options.appRoot]
 * @returns {Promise<{ summary: string }>}
 */
async function proveMigrationHistory({ knexConfig, environment, schema = {}, appRoot = process.cwd() }) {
  const dialect = dialectOf(knexConfig);
  const name = requireDisposableDatabase(environment, "TEST_DB_NAME", 1, { connected: knexConfig.connection.database });
  const root = path.resolve(appRoot);
  const { key, migrations } = await testDatabaseSnapshotKey(knexConfig, { appRoot: root, schemaFiles: schema.files });
  const build = schema.build ?? ((knex) => knex.migrate.latest());
  const snapshot = await dialect.ensureSnapshot(knexConfig, name, key, root, build);
  const failure = (reason) => new Error(`The migration history proof: ${reason}`);
  try {
    await dialect.clear(knexConfig, name);
    const started = performance.now();
    const left = await withKnex(knexConfig, name, async (knex) => {
      await build(knex);
      return (await knex.migrate.latest())[1];
    });
    const replayMs = milliseconds(started);
    if (left.length > 0) {
      throw failure(`a second pass over ${name} applied ${left.length} migration(s) the ${schema.build ? "schema build" : "first"} ` +
        `left: ${left.join(", ")}. The tests run on what the first pass built, without them: build the whole schema in one.`);
    }
    const differing = await dialect.differences(knexConfig, name, snapshot);
    if (differing.length > 0) {
      throw failure(`${name}, built from empty, differs from the test snapshot in ${differing.join(", ")}: a migration builds ` +
        "something else on each replay (from the clock, a random value or what the server holds), so the tests run on a schema " +
        "the history does not build. Make each migration build the same definitions and rows every time.");
    }
    return {
      summary: `${schema.build ? "schema built" : `${migrations.length} migrations replayed`} from empty into ${name} in ${replayMs}ms, ` +
        `nothing left for a second pass, the same tables, definitions and rows as the test snapshot (${snapshot.tables.length} tables)`
    };
  } finally {
    await restoreTestDatabase(knexConfig, name, snapshot);
  }
}

/** The server refused the database user a database or table it needs, rather than failing in some other way. */
function refusedPrivilege(error) {
  return MYSQL_REFUSED_PRIVILEGE.has(error?.code) || error?.code === POSTGRES_INSUFFICIENT_PRIVILEGE;
}

/**
 * How `jskit test --databases` runs the Node test files: in parallel, each file with a database of its own for as long
 * as it runs (`testDatabaseFile.js`, preloaded into every file's process); or, with no usable TEST_DB_NAME (unset, the
 * connected database itself, or one the database user may not prepare), one file at a time on the connected database.
 * Of the `asked` files at once, `concurrency` run; when fewer, `shortfall` says why, for the runner to report and fail
 * on. Anything else that stops the preparation, such as a TEST_DB_NAME copy named like a protected database or an
 * unreachable server, fails the run. Its cleanup() ends the run, removing its settings and dropping its copies.
 * @param {object} options
 * @param {{ client: string, connection: object, migrations?: object }} options.knexConfig
 * @param {Record<string, string | undefined>} options.environment
 * @param {number} options.count How many test files run at once: at most the run's test budget.
 * @param {TestDatabaseSchema} [options.schema]
 * @param {string} [options.appRoot]
 * @param {(knex: import("knex").Knex) => Promise<string>} [options.checkDatabase] Runs once on the prepared TEST_DB_NAME,
 *   before any test file: what it answers joins the summary, and a throw drops the copies and fails the run.
 */
async function testDatabaseRun({ knexConfig, environment, count, schema, appRoot = process.cwd(), checkDatabase }) {
  assertNoRetiredVariables(environment);
  const oneAtATime = (reason) => ({
    concurrency: 1,
    asked: count,
    shortfall: count > 1 ? reason : "",
    env: {},
    preload: "",
    summary: `test files run one at a time on the connected database: ${reason}`,
    cleanup() {}
  });
  const testDatabase = String(environment.TEST_DB_NAME || "").trim();
  if (!testDatabase) return oneAtATime("TEST_DB_NAME is not set");
  if (folded(connectedDatabaseName(environment)) === folded(testDatabase)) {
    return oneAtATime(`the connected database is TEST_DB_NAME (${testDatabase})`);
  }
  let prepared;
  try {
    prepared = await prepareTestDatabases({ knexConfig, environment, count, schema, appRoot });
  } catch (error) {
    if (!refusedPrivilege(error)) throw error;
    return oneAtATime(`the database user may not prepare ${testDatabase} (${error.code})`);
  }
  const checked = await dropCopiesIfThrows(knexConfig, prepared.databases, async () =>
    (checkDatabase ? withKnex(knexConfig, prepared.databases[0], checkDatabase) : ""));
  // mkdtemp makes the directory for this user alone; the settings file holds the connection password.
  const directory = mkdtempSync(path.join(os.tmpdir(), "jskit-test-databases-"));
  const { client, connection, migrations } = knexConfig;
  const settings = path.join(directory, RUN_SETTINGS_FILE);
  writeFileSync(settings, JSON.stringify({
    databases: prepared.databases,
    snapshot: prepared.snapshot,
    knexConfig: { client, connection, migrations: { tableName: ledgerOf({ migrations }) } }
  }), { mode: 0o600 });
  return {
    concurrency: prepared.databases.length,
    asked: count,
    shortfall: prepared.shortfall,
    env: { JSKIT_TEST_DATABASES: directory },
    preload: TEST_DATABASE_FILE,
    summary: `${prepared.summary}${checked ? `; ${checked}` : ""}`,
    cleanup: () => endTestDatabaseRun(knexConfig, prepared.databases, directory)
  };
}

// The recordings open in the current async context, outermost first: a statement counts for each recording whose work
// (or work it started) sends it, and for no other, so a test or a loop running beside the work is left out.
const openRecordings = new AsyncLocalStorage();

/**
 * Runs `work` while `listen` hands each statement to the recorder it is given, and stops listening when `work` ends.
 * The recorder keeps only the statements sent from `work`'s own async context, and from the async work it starts.
 * @template T
 * @param {(record: (query: { sql: string }) => void) => () => void} listen Starts listening; returns how to stop.
 * @param {() => Promise<T> | T} work
 * @returns {Promise<{ result: T, count: number, queries: string[] }>}
 */
async function recordStatements(listen, work) {
  const queries = [];
  const recording = Symbol("recording");
  const stop = listen((query) => {
    if (openRecordings.getStore()?.includes(recording)) queries.push(String(query.sql));
  });
  try {
    // Awaited inside the scope: work may answer a lazy thenable, such as a Knex builder or app.inject()'s chain, that
    // sends its statement only once it is awaited.
    const result = await openRecordings.run([...(openRecordings.getStore() || []), recording], async () => await work());
    return { result, count: queries.length, queries };
  } finally {
    stop();
  }
}

/**
 * Runs `work` and records the SQL of every statement `knex` sends meanwhile, its transactions' included (their BEGIN
 * and COMMIT among them), for a test that compares a path's statements at a few rows and at many. Pass the Knex
 * instance or transaction the work runs on. Only the statements `work` sends count, with those of the async work it
 * starts: another test or a background loop sending through the same Knex meanwhile is left out, and so is a loop
 * started before `work` that sends on its behalf.
 * @template T
 * @param {import("knex").Knex | import("knex").Knex.Transaction} knex
 * @param {() => Promise<T> | T} work
 * @returns {Promise<{ result: T, count: number, queries: string[] }>} `work`'s result, how many statements it sent and
 *   their SQL, in order.
 */
async function countQueries(knex, work) {
  return recordStatements((record) => {
    knex.on("query", record);
    return () => knex.off("query", record);
  }, work);
}

/**
 * Runs `work` and records the SQL of every statement the application runtime's own database sends meanwhile: the
 * `runtime.database` Knex of each server this process booted, as a test that creates the server with `createServer()`
 * and calls a route with `app.inject()` does, its transactions' included. A Knex the test made itself is not counted,
 * and neither is a server in another process. Only the statements `work` sends count, as countQueries() counts them:
 * the runtime's statements for anything else meanwhile, such as a background loop's, are left out.
 * @template T
 * @param {() => Promise<T> | T} work
 * @returns {Promise<{ result: T, count: number, queries: string[] }>} `work`'s result, how many statements the runtime
 *   sent and their SQL, in order.
 */
async function countRuntimeQueries(work) {
  return recordStatements((record) => {
    diagnosticsChannel.subscribe(RUNTIME_QUERY_CHANNEL, record);
    return () => diagnosticsChannel.unsubscribe(RUNTIME_QUERY_CHANNEL, record);
  }, work);
}

/** A data test that has no test database: it fails rather than skip. */
class TestDatabaseMissingError extends Error {
  constructor() {
    super("TEST_DB_NAME is not set; data tests never skip.");
    this.name = "TestDatabaseMissingError";
  }
}

/**
 * The test database a data test runs on. A data test never skips: without TEST_DB_NAME it throws
 * TestDatabaseMissingError, so a run without a database fails instead of passing what it never ran.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} environment The test's environment, such as `process.env`.
 * @returns {string}
 */
function requireTestDatabase(environment) {
  const name = String(environment.TEST_DB_NAME || "").trim();
  if (!name) {
    throw new TestDatabaseMissingError();
  }
  return name;
}

// A package test's connections: enough for the concurrent transactions a lock or race test opens at once.
const PACKAGE_TEST_POOL = Object.freeze({ min: 0, max: 8 });

/**
 * The Knex a package's own data test runs on, for a test that creates its own tables, on the run's DB_CLIENT: SQLite
 * in memory unless it is pg or mysql2; on pg, a schema of the test's own in TEST_DB_NAME, its sessions in UTC as an
 * application's are; on mysql2, the first of TEST_DB_NAME's 26 lettered copies, `<TEST_DB_NAME>_a` to `_z`, no other
 * test holds, claimed under a lock on the database server and recreated empty (mysqlPackageTestDatabase.js), with an
 * application's mysql2 connection settings; both on the server DB_HOST, DB_PORT, DB_USER and DB_PASSWORD name. So one
 * file proves its data paths, row locks, many-row writes and upserts included, on each, its files running at once, with
 * no driver beyond the run's own. The Knex is destroyed after the test, and the schema or copy dropped with all in it.
 * A pg or mysql2 run without TEST_DB_NAME fails (TestDatabaseMissingError), as every data test does;
 * `knex.client.config.client` tells a test which it got.
 * @param {{ after(cleanup: () => unknown): unknown }} context The test's context (node:test's `t`).
 * @param {{ environment: import("@jskit-ai/kernel/server/types").RuntimeEnv }} options The test's environment, such as
 *   `process.env`.
 * @returns {Promise<import("knex").Knex>}
 */
async function createPackageTestKnex(context, { environment }) {
  const knexFactory = loadKnexFactory();
  const client = String(environment.DB_CLIENT || "").trim();
  if (client !== "pg" && client !== "mysql2") {
    const knex = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
    context.after(() => knex.destroy());
    return knex;
  }
  if (isStagingOrProduction(environment)) {
    throw new Error(`Package data tests never run when APP_ENV is ${appEnvironment(environment)}.`);
  }
  if (client === "mysql2") {
    const testDatabase = requireTestDatabase(environment);
    return createMysqlPackageTestKnex(context, { knexFactory, environment, testDatabase, pool: PACKAGE_TEST_POOL });
  }
  const connection = {
    ...resolveKnexConnectionFromEnvironment(environment, { client: "pg", defaultPort: 5432 }),
    database: requireTestDatabase(environment)
  };
  const schema = `jskit_test_${process.pid}_${randomBytes(6).toString("hex")}`;
  const admin = knexFactory({ client: "pg", connection, pool: { min: 0, max: 1 } });
  try {
    await admin.raw("CREATE SCHEMA ??", [schema]);
  } catch (error) {
    await admin.destroy();
    throw error;
  }
  const knex = knexFactory({ client: "pg", connection, searchPath: [schema], pool: { ...resolveKnexPool("pg"), ...PACKAGE_TEST_POOL } });
  context.after(() => dropPackageTestData(knex, admin, "DROP SCHEMA IF EXISTS ?? CASCADE", schema));
  return knex;
}

// Destroys a package test's Knex, then drops its PostgreSQL schema through `admin`, and destroys `admin`.
async function dropPackageTestData(knex, admin, statement, name) {
  try {
    await knex.destroy();
    await admin.raw(statement, [name]);
  } finally {
    await admin.destroy();
  }
}

/**
 * The settings of the `jskit test --databases` run whose file `environment` is (its databases, snapshot and Knex
 * settings); outside such a run it fails, saying what `use` needs and naming the command.
 */
function runSettings(environment, use) {
  const file = String(environment[RUN_SETTINGS_VARIABLE] || "").trim();
  if (!file) {
    throw new Error(`${use} the snapshot of a \`jskit test --databases\` run, and this file runs outside one: run it ` +
      "with `jskit test --databases`.");
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Another database holding the run's snapshot, for a file of a `jskit test --databases` run that needs more than its
 * own TEST_DB_NAME copy (a second tenant, a second server): one of the run's designated database's 26 lettered copies,
 * `<name>_a` to `_z`, that no other test holds, claimed under a lock on the database server held for as long as the
 * test runs (createPackageTestKnex() claims the same copies on MySQL and MariaDB, under the same locks), and restored
 * from the run's snapshot, rows included. Each call claims another. The test's teardown destroys the Knex and drops the
 * copy, whether the test passed or failed. Outside such a run it fails, naming the command.
 * @param {{ after(cleanup: () => unknown): unknown }} context The test's context (node:test's `t`).
 * @param {{ environment: import("@jskit-ai/kernel/server/types").RuntimeEnv }} options The file's environment, such as
 *   `process.env`.
 * @returns {Promise<{ database: string, knex: import("knex").Knex }>}
 */
async function claimTestDatabaseCopy(context, { environment }) {
  const { databases, snapshot, knexConfig } = runSettings(environment, "claimTestDatabaseCopy() copies");
  const knexFactory = loadKnexFactory();
  if (knexConfig.client !== "pg") {
    const knex = await createMysqlPackageTestKnex(context, { knexFactory, environment, testDatabase: databases[0],
      pool: PACKAGE_TEST_POOL, fill: (database) => restoreTestDatabase(knexConfig, database, snapshot) });
    return { database: knex.client.config.connection.database, knex };
  }
  return claimPostgresCopy(context, { knexFactory, knexConfig, snapshot, base: databases[0] });
}

/**
 * claimTestDatabaseCopy() on PostgreSQL: the first lettered copy of `base` whose advisory lock no other session holds,
 * the lock held by a session of its own on the maintenance database for as long as the test runs, recreated from the
 * snapshot database.
 */
async function claimPostgresCopy(context, { knexFactory, knexConfig, snapshot, base }) {
  const admin = knexFactory({ client: "pg", connection: { ...knexConfig.connection, database: POSTGRES_MAINTENANCE_DATABASE },
    pool: { min: 0, max: 1 } });
  let session;
  const on = (sql, bindings = []) => admin.raw(sql, bindings).connection(session);
  const giveUp = async () => {
    try {
      if (session) await admin.client.releaseConnection(session);
    } finally {
      await admin.destroy();
    }
  };
  let database = "";
  try {
    session = await admin.client.acquireConnection();
    for (const deadline = Date.now() + COPY_CLAIM_TIMEOUT_MS; !database; await delay(250)) {
      for (const name of letteredCopies(base)) {
        const { rows: [{ claimed }] } = await on("SELECT pg_try_advisory_lock(hashtext(?)) AS claimed", [name]);
        if (claimed) {
          database = name;
          break;
        }
      }
      if (!database && Date.now() >= deadline) {
        throw new Error(`All 26 lettered copies of ${base} are held by other tests, and none came free within ` +
          `${COPY_CLAIM_TIMEOUT_MS / 1000}s: let some finish, or run fewer at once.`);
      }
    }
  } catch (error) {
    await giveUp();
    throw error;
  }
  let knex = null;
  // From here the test's teardown drops the copy, whatever the test or the restore does.
  context.after(async () => {
    try {
      await knex?.destroy();
      await on("DROP DATABASE IF EXISTS ??", [database]);
      await on("SELECT pg_advisory_unlock(hashtext(?))", [database]);
    } finally {
      await giveUp();
    }
  });
  await restoreTestDatabase(knexConfig, database, snapshot);
  knex = knexFactory({ client: "pg", connection: { ...knexConfig.connection, database },
    pool: { ...resolveKnexPool("pg"), ...PACKAGE_TEST_POOL } });
  return { database, knex };
}

/**
 * Restores the file's own copy, its TEST_DB_NAME in a `jskit test --databases` run, to the run's snapshot mid-file, for
 * a test that needs the snapshot afresh after earlier tests of the file wrote to it, and answers the tables it
 * replaced, sorted: only those that differ from the snapshot's (restoreTestDatabase()), so a reset after a test that
 * wrote one table costs one. The file's connections stay open; hold no transaction across it. MySQL and MariaDB only:
 * on PostgreSQL a restore recreates the database, which the file's own connections hold, so it refuses, naming a file
 * of its own or claimTestDatabaseCopy(). Outside such a run it fails, naming the command.
 * @param {{ environment: import("@jskit-ai/kernel/server/types").RuntimeEnv }} options The file's environment, such as
 *   `process.env`.
 * @returns {Promise<string[]>}
 */
async function resetTestDatabase({ environment }) {
  const { databases, snapshot, knexConfig } = runSettings(environment, "resetTestDatabase() restores");
  if (knexConfig.client === "pg") {
    throw new Error("resetTestDatabase() restores a MySQL or MariaDB copy in place; on PostgreSQL a restore recreates " +
      "the database, which this file's own connections hold: put tests that each need the snapshot afresh in files of " +
      "their own, or give such a test another copy with claimTestDatabaseCopy().");
  }
  const database = String(environment.TEST_DB_NAME || "").trim();
  if (!databases.includes(database)) {
    throw new Error(`resetTestDatabase() restores this file's own copy, and TEST_DB_NAME names ${database || "none"}, ` +
      "which is not one of the run's: pass the file's environment (process.env).");
  }
  return restoreTestDatabase(knexConfig, database, snapshot);
}

/**
 * The tables of the database `knex` is connected to, sorted: MySQL's and MariaDB's base tables, PostgreSQL's in the
 * current schema, SQLite's own tables (its internal ones aside).
 * @param {import("knex").Knex | import("knex").Knex.Transaction} knex
 * @returns {Promise<string[]>}
 */
async function tableNames(knex) {
  const client = String(knex.client.config.client);
  if (client.includes("sqlite")) {
    const rows = await knex.raw("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
    return rows.map(({ name }) => name).sort();
  }
  // Knex names PostgreSQL "pg", "postgres" or "postgresql".
  if (detectDialectFromClient(knex) === "postgres") {
    return DIALECTS.pg.tables(knex);
  }
  const [[{ name: database }]] = await knex.raw("SELECT DATABASE() AS name");
  return DIALECTS.mysql2.tables(knex, database);
}

export {
  RUN_SETTINGS_FILE,
  RUN_SETTINGS_VARIABLE,
  TestDatabaseMissingError,
  claimTestDatabaseCopy,
  countQueries,
  createPackageTestKnex,
  countRuntimeQueries,
  matchesSnapshot,
  prepareTestDatabases,
  proveMigrationHistory,
  requireDisposableDatabase,
  requireTestDatabase,
  resetTestDatabase,
  restoreTestDatabase,
  tableNames,
  testDatabaseNames,
  testDatabaseRun,
  testDatabaseSnapshotKey
};
