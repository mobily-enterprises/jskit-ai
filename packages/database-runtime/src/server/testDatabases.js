// The disposable databases of a test run, and the stored schema snapshots they are restored from.
//
// A run gets one database per test file or browser worker running at once: the designated one (TEST_DB_NAME for Node
// test files, BROWSER_TEST_DB_NAME for browser workers), then copies named after it (`<name>_1`, `_2`, ...) where the
// database user may create them. Each starts from a snapshot of the schema the migrations build, with the rows they
// write, instead of replaying every migration. A snapshot is taken once from a real replay into the designated
// database, keyed by the dialect, the names and contents of the migrations and the application's package-lock.json
// (a package upgrade can change what its migrations' helpers build), so changing, adding or reordering a migration, or
// installing other packages, takes a new one:
//
// - MySQL and MariaDB: each table's SHOW CREATE TABLE and its rows, in a file under
//   `node_modules/.cache/jskit-test-databases/` named after the key and the server's version;
// - PostgreSQL: a prepared database, `<name>_snapshot`, that every copy is created from with
//   CREATE DATABASE ... TEMPLATE (STRATEGY FILE_COPY from PostgreSQL 15).
//
// The database the application connects to (DB_NAME, the one DATABASE_URL names, the Knex configuration's own) and
// PROD_DB_NAME are never touched. Two runs at once need different database names, as before.
//
// A database test that guards a path's cost counts the statements the path sends with countQueries(), or, for a route
// of a server the test booted, countRuntimeQueries().
import { createHash } from "node:crypto";
import diagnosticsChannel from "node:diagnostics_channel";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDatabaseUrl } from "../shared/databaseConnection.js";
import { RUNTIME_QUERY_CHANNEL } from "./database.js";
import { loadKnexFactory } from "./knexFactory.js";

const SNAPSHOT_DIRECTORY = path.join("node_modules", ".cache", "jskit-test-databases");
// Room for a `_snapshot` or copy suffix within MySQL's 64 and PostgreSQL's 63 characters.
const DISPOSABLE_NAME = /^[A-Za-z0-9_]{1,48}$/u;
const TEST_DATABASE_VARIABLES = Object.freeze(["TEST_DB_NAME", "BROWSER_TEST_DB_NAME"]);
const MYSQL_ACCESS_DENIED = new Set(["ER_DBACCESS_DENIED_ERROR", "ER_ACCESS_DENIED_ERROR", "ER_SPECIFIC_ACCESS_DENIED_ERROR"]);
// A database or table the user may not use (not a wrong password, which fails the run).
const MYSQL_REFUSED_PRIVILEGE = new Set(["ER_DBACCESS_DENIED_ERROR", "ER_SPECIFIC_ACCESS_DENIED_ERROR", "ER_TABLEACCESS_DENIED_ERROR"]);
const POSTGRES_INSUFFICIENT_PRIVILEGE = "42501";
// The run's settings, connection password included, in a file only this user can read; the environment names its
// directory only.
const RUN_SETTINGS_FILE = "settings.json";
// The database a PostgreSQL connection uses to create, drop and copy the test databases.
const POSTGRES_MAINTENANCE_DATABASE = "postgres";
// PostgreSQL 15 and later copy a template file by file (STRATEGY FILE_COPY) instead of through the write-ahead log, the
// default there: about half the time per copy of a test schema, and less again with copies made at once.
const POSTGRES_FILE_COPY_VERSION = 150000;
// MySQL values read as text, so every captured row writes back as the SQL literal it came from.
const MYSQL_SNAPSHOT_CONNECTION = Object.freeze({
  dateStrings: true,
  jsonStrings: true,
  supportBigNumbers: true,
  bigNumberStrings: true
});
const MYSQL_GENERATED_COLUMN = /\b(?:VIRTUAL|STORED|PERSISTENT) GENERATED\b/iu;
const INSERT_BATCH = 500;
const TEST_DATABASE_FILE = fileURLToPath(new URL("./testDatabaseFile.js", import.meta.url));
const LOCKFILE = "package-lock.json";

const folded = (value) => String(value ?? "").trim().toLowerCase();
const milliseconds = (since) => Math.round(performance.now() - since);
const ledgerOf = (knexConfig) => knexConfig.migrations?.tableName || "knex_migrations";

/**
 * The databases for `count` test files or workers at once: `name`, then its numbered copies.
 * @param {string} name
 * @param {number} count
 */
function testDatabaseNames(name, count) {
  return Array.from({ length: count }, (_, index) => (index ? `${name}_${index}` : name));
}

/** The database the application's environment connects to: DB_NAME, else the one DATABASE_URL names. */
function connectedDatabaseName(environment) {
  return String(environment.DB_NAME || "").trim() ||
    parseDatabaseUrl(environment.DATABASE_URL, { allowEmpty: true })?.database || "";
}

/**
 * The disposable database `variable` names, checked with its first `count - 1` copies: never production, never the
 * application's database (DB_NAME, DATABASE_URL's, PROD_DB_NAME, and `connected`, the one its Knex configuration
 * names), and never the other test database or its copies.
 * @param {Record<string, string | undefined>} environment
 * @param {"TEST_DB_NAME" | "BROWSER_TEST_DB_NAME"} variable
 * @param {number} [count]
 * @param {{ connected?: string }} [options]
 */
function requireDisposableDatabase(environment, variable, count = 1, { connected = "" } = {}) {
  if (environment.NODE_ENV === "production") {
    throw new Error("Test databases are never prepared with NODE_ENV=production.");
  }
  const name = String(environment[variable] || "").trim();
  if (!DISPOSABLE_NAME.test(name)) {
    throw new Error(`${variable} must name a disposable test database: letters, digits and _, at most 48 characters.`);
  }
  const application = [connectedDatabaseName(environment), environment.DB_NAME, environment.PROD_DB_NAME, connected]
    .map(folded).filter(Boolean);
  const others = TEST_DATABASE_VARIABLES.filter((other) => other !== variable)
    .map((other) => folded(environment[other])).filter(Boolean);
  // `copy` is `original` or one of its numbered copies, whatever the count of either run.
  const isCopy = (copy, original) => copy === original ||
    (copy.startsWith(`${original}_`) && /^\d+$/u.test(copy.slice(original.length + 1)));
  for (const candidate of testDatabaseNames(name, count).map(folded)) {
    if (application.includes(candidate)) {
      throw new Error(`${variable} and its copies must differ from the application's DB_NAME, DATABASE_URL and PROD_DB_NAME (${candidate}).`);
    }
  }
  for (const other of others) {
    if (isCopy(folded(name), other) || isCopy(other, folded(name))) {
      throw new Error(`${variable} and its copies must differ from the other test database and its copies (${other}).`);
    }
  }
  return name;
}

function knexOn(knexConfig, database, connectionOptions = {}) {
  return loadKnexFactory()({
    ...knexConfig,
    connection: { ...knexConfig.connection, ...connectionOptions, database },
    pool: { min: 0, max: 1 }
  });
}

async function withKnex(knexConfig, database, use, connectionOptions) {
  const knex = knexOn(knexConfig, database, connectionOptions);
  try {
    return await use(knex);
  } finally {
    await knex.destroy();
  }
}

/**
 * Every migration Knex applies, in its order, and the key of the schema they build: a digest of the dialect, of each
 * migration's name and contents and of the application's package-lock.json. A migration's own file does not show a
 * change in a helper it imports from an installed package; the lockfile does, when that package is upgraded.
 * @param {{ client: string, connection: object, migrations?: object }} knexConfig
 * @param {{ appRoot?: string }} [options]
 * @returns {Promise<{ key: string, migrations: string[] }>}
 */
async function testDatabaseSnapshotKey(knexConfig, { appRoot = process.cwd() } = {}) {
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
    const lockfile = path.join(path.resolve(appRoot), LOCKFILE);
    hash.update(`\0${LOCKFILE}\0`);
    if (existsSync(lockfile)) hash.update(readFileSync(lockfile));
    return { key: hash.digest("hex").slice(0, 32), migrations };
  } finally {
    await knex.destroy();
  }
}

async function ledgerNames(knex, ledger, tables) {
  if (!tables.includes(ledger)) return [];
  const result = await knex.raw("SELECT name FROM ?? ORDER BY id", [ledger]);
  return (knex.client.config.client === "pg" ? result.rows : result[0]).map(({ name }) => name);
}

const mysql = {
  async tables(knex, database) {
    const [rows] = await knex.raw(
      "SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]
    );
    if (rows.some(({ type }) => type !== "BASE TABLE")) throw new Error(`${database} holds a view; test databases hold tables only.`);
    return rows.map(({ name }) => name).sort();
  },

  // Runs on the pool's one connection, so FOREIGN_KEY_CHECKS applies to every statement.
  async replaceTables(knex, database, statements) {
    const [[actual]] = await knex.raw("SELECT DATABASE() AS name");
    if (actual.name !== database) throw new Error(`A test database restore requires a connection to ${database}.`);
    const existing = await mysql.tables(knex, database);
    await knex.raw("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const name of existing) await knex.raw("DROP TABLE ??", [name]);
      for (const statement of statements) await knex.raw(statement);
    } finally {
      await knex.raw("SET FOREIGN_KEY_CHECKS = 1");
    }
  },

  /** Each table's definition and its rows as INSERT statements (generated columns left to the server). */
  async capture(knex, database) {
    // SHOW CREATE TABLE carries neither, so a copy would silently lack them.
    const [[{ triggers, routines, events }]] = await knex.raw(
      "SELECT (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?) AS triggers, " +
        "(SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?) AS routines, " +
        "(SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?) AS events",
      [database, database, database]
    );
    if (Number(triggers) + Number(routines) + Number(events) > 0) {
      throw new Error(`${database} holds triggers, routines or events; MySQL test databases restored from a snapshot hold tables only.`);
    }
    const [columns] = await knex.raw(
      "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?",
      [database]
    );
    const tables = [];
    for (const name of await mysql.tables(knex, database)) {
      const [[definition]] = await knex.raw("SHOW CREATE TABLE ??", [name]);
      const [rows] = await knex.raw("SELECT * FROM ??", [name]);
      const generated = columns.filter((column) => column.tableName === name && MYSQL_GENERATED_COLUMN.test(column.extra))
        .map((column) => column.name);
      for (const row of rows) for (const column of generated) delete row[column];
      const inserts = [];
      for (let start = 0; start < rows.length; start += INSERT_BATCH) {
        inserts.push(knex(name).insert(rows.slice(start, start + INSERT_BATCH)).toQuery());
      }
      tables.push({ name, create: definition["Create Table"], inserts });
    }
    return tables;
  },

  async ensureSnapshot(knexConfig, database, { key, migrations }, appRoot) {
    // Another server version may write, or accept, another SHOW CREATE TABLE.
    const version = await withKnex(knexConfig, undefined, async (knex) => (await knex.raw("SELECT VERSION() AS version"))[0][0].version);
    const server = createHash("sha256").update(String(version)).digest("hex").slice(0, 8);
    const file = path.join(appRoot, SNAPSHOT_DIRECTORY, `${key}-${server}.json`);
    const snapshot = { key, file, migrations };
    if (existsSync(file)) {
      return { ...snapshot, tables: JSON.parse(readFileSync(file, "utf8")).tables.map(({ name }) => name), replayed: false };
    }
    await mysql.createDatabase(knexConfig, database);
    // The migrations run on the application's own connection settings; only the capture reads values as text.
    await withKnex(knexConfig, database, async (knex) => {
      await mysql.replaceTables(knex, database, []);
      await knex.migrate.latest();
    });
    const tables = await withKnex(knexConfig, database, (knex) => mysql.capture(knex, database), MYSQL_SNAPSHOT_CONNECTION);
    mkdirSync(path.dirname(file), { recursive: true });
    // Written whole, then renamed, so a run beside this one never reads half a snapshot.
    writeFileSync(`${file}.${process.pid}`, JSON.stringify({ migrations, tables }));
    renameSync(`${file}.${process.pid}`, file);
    return { ...snapshot, tables: tables.map(({ name }) => name), replayed: true };
  },

  /** Creates `database` unless it exists; false when the database user may not create it. */
  async createDatabase(knexConfig, database) {
    return withKnex(knexConfig, undefined, async (knex) => {
      try {
        await knex.raw("CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci", [database]);
        return true;
      } catch (error) {
        if (MYSQL_ACCESS_DENIED.has(error.code)) return false;
        throw error;
      }
    });
  },

  async restore(knexConfig, database, snapshot) {
    const { tables } = JSON.parse(readFileSync(snapshot.file, "utf8"));
    // A test may have dropped the whole database; one the user may not create but that exists is restored in place.
    await mysql.createDatabase(knexConfig, database);
    await withKnex(knexConfig, database, (knex) => mysql.replaceTables(knex, database, [
      ...tables.map(({ create }) => create),
      ...tables.flatMap(({ inserts }) => inserts)
    ]));
    return true;
  },

  async provide(knexConfig, databases, snapshot) {
    const provided = [];
    for (const [index, database] of databases.entries()) {
      // The designated database may exist already for a user who cannot create databases.
      if (!(await mysql.createDatabase(knexConfig, database)) && index > 0) break;
      provided.push(database);
    }
    await Promise.all(provided.map((database) => mysql.restore(knexConfig, database, snapshot)));
    return provided;
  },

  async outline(knexConfig, database) {
    return withKnex(knexConfig, database, async (knex) => {
      const tables = await mysql.tables(knex, database);
      return { tables, migrations: await ledgerNames(knex, ledgerOf(knexConfig), tables) };
    });
  }
};

const postgres = {
  // Tables and views alike: a copy made from the template database carries everything the migrations made.
  async tables(knex) {
    const { rows } = await knex.raw("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()");
    return rows.map(({ name }) => name).sort();
  },

  maintenance(knexConfig, use) {
    return withKnex(knexConfig, POSTGRES_MAINTENANCE_DATABASE, use);
  },

  async ensureSnapshot(knexConfig, database, { key, migrations }) {
    const snapshotDatabase = `${database}_snapshot`;
    const label = `jskit-test-snapshot ${key}`;
    const snapshot = { key, database: snapshotDatabase, migrations };
    const current = await postgres.maintenance(knexConfig, async (knex) => {
      const { rows } = await knex.raw(
        "SELECT shobj_description(oid, 'pg_database') AS label FROM pg_database WHERE datname = ?", [snapshotDatabase]
      );
      return rows[0]?.label || "";
    });
    const replayed = current !== label;
    if (replayed) {
      await postgres.maintenance(knexConfig, async (knex) => {
        await knex.raw("DROP DATABASE IF EXISTS ??", [snapshotDatabase]);
        await knex.raw("CREATE DATABASE ??", [snapshotDatabase]);
      });
      await withKnex(knexConfig, snapshotDatabase, (knex) => knex.migrate.latest());
      // The key is hexadecimal, so it is safe inline; COMMENT takes no bound parameters.
      await postgres.maintenance(knexConfig, (knex) => knex.raw(`COMMENT ON DATABASE ?? IS '${label}'`, [snapshotDatabase]));
    }
    // Read, then closed: a template database is copied only while nothing is connected to it.
    const tables = await withKnex(knexConfig, snapshotDatabase, (knex) => postgres.tables(knex));
    return { ...snapshot, tables, replayed };
  },

  /** Recreates `database` from the snapshot; false when the database user may not create databases. */
  async restore(knexConfig, database, snapshot) {
    return postgres.maintenance(knexConfig, async (knex) => {
      try {
        await knex.raw("DROP DATABASE IF EXISTS ??", [database]);
        const { rows: [{ server_version_num: version }] } = await knex.raw("SHOW server_version_num");
        const strategy = Number(version) >= POSTGRES_FILE_COPY_VERSION ? " STRATEGY FILE_COPY" : "";
        await knex.raw(`CREATE DATABASE ?? TEMPLATE ??${strategy}`, [database, snapshot.database]);
        return true;
      } catch (error) {
        if (error.code === POSTGRES_INSUFFICIENT_PRIVILEGE) return false;
        throw error;
      }
    });
  },

  // One at a time: each copy reads the template while it is made.
  async provide(knexConfig, databases, snapshot) {
    const provided = [];
    for (const database of databases) {
      if (!(await postgres.restore(knexConfig, database, snapshot))) break;
      provided.push(database);
    }
    if (provided.length < 1) throw new Error(`The database user may not create ${databases[0]} from the snapshot (CREATEDB).`);
    return provided;
  },

  async outline(knexConfig, database) {
    return withKnex(knexConfig, database, async (knex) => {
      const tables = await postgres.tables(knex);
      return { tables, migrations: await ledgerNames(knex, ledgerOf(knexConfig), tables) };
    });
  }
};

const DIALECTS = Object.freeze({
  mysql2: mysql,
  pg: postgres
});

function dialectOf(knexConfig) {
  const dialect = DIALECTS[knexConfig?.client];
  if (!dialect || !knexConfig.connection || typeof knexConfig.connection !== "object") {
    throw new Error("Test databases need the application's resolved MySQL (mysql2) or PostgreSQL (pg) Knex configuration.");
  }
  return dialect;
}

/**
 * Prepares the disposable databases for up to `count` test files or browser workers at once, each holding the current
 * migrations' schema afresh, then the seed's rows when given: the database `variable` names, then the numbered copies
 * the database user may create.
 * @param {object} options
 * @param {{ client: string, connection: object, migrations?: object }} options.knexConfig The application's Knex
 *   migration configuration (its knexfile.js), from `createKnexMigrationConfigFromApp()`.
 * @param {Record<string, string | undefined>} options.environment The application's environment, such as `process.env`.
 * @param {"TEST_DB_NAME" | "BROWSER_TEST_DB_NAME"} [options.variable]
 * @param {number} [options.count]
 * @param {(transaction: import("knex").Knex.Transaction) => unknown} [options.seed] Runs in each database, in one
 *   transaction, after its restore.
 * @param {string} [options.appRoot]
 */
async function prepareTestDatabases({
  knexConfig,
  environment,
  variable = "TEST_DB_NAME",
  count = 1,
  seed,
  appRoot = process.cwd()
}) {
  const started = performance.now();
  const dialect = dialectOf(knexConfig);
  const name = requireDisposableDatabase(environment, variable, count, { connected: knexConfig.connection.database });
  const root = path.resolve(appRoot);
  const snapshot = await dialect.ensureSnapshot(knexConfig, name, await testDatabaseSnapshotKey(knexConfig, { appRoot: root }), root);
  const restoreStarted = performance.now();
  const databases = await dialect.provide(knexConfig, testDatabaseNames(name, count), snapshot);
  const restoreMs = milliseconds(restoreStarted);
  const seedStarted = performance.now();
  if (seed) {
    await Promise.all(databases.map((database) => withKnex(knexConfig, database, (knex) => knex.transaction(seed))));
  }
  const seedMs = milliseconds(seedStarted);
  const { replayed, ...stored } = snapshot;
  return {
    databases,
    snapshot: stored,
    summary: `${databases.length} test database(s) from ${name} ready in ${milliseconds(started)}ms: ` +
      (replayed ? `${snapshot.migrations.length} migrations replayed once for a new snapshot, ` : "stored snapshot, ") +
      `restore ${restoreMs}ms${seed ? `, seed ${seedMs}ms` : ""}`
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

/** Replaces every table of `database`, which must be disposable, with the snapshot's. */
async function restoreTestDatabase(knexConfig, database, snapshot) {
  if (!(await dialectOf(knexConfig).restore(knexConfig, database, snapshot))) {
    throw new Error(`The database user may not recreate ${database}.`);
  }
}

/** The server refused the database user a database or table it needs, rather than failing in some other way. */
function refusedPrivilege(error) {
  return MYSQL_REFUSED_PRIVILEGE.has(error?.code) || error?.code === POSTGRES_INSUFFICIENT_PRIVILEGE;
}

/**
 * How `jskit test --databases` runs the Node test files: in parallel, each file with a database of its own for as long
 * as it runs (`testDatabaseFile.js`, preloaded into every file's process); or, with no usable TEST_DB_NAME (unset, the
 * connected database itself, or one the database user may not prepare), one file at a time on the connected database,
 * as before. Anything else that stops the preparation, such as a TEST_DB_NAME copy named like a protected database or
 * an unreachable server, fails the run.
 * @param {object} options
 * @param {{ client: string, connection: object, migrations?: object }} options.knexConfig
 * @param {Record<string, string | undefined>} options.environment
 * @param {number} options.count How many test files run at once: at most the run's test budget.
 * @param {string} [options.appRoot]
 */
async function testDatabaseRun({ knexConfig, environment, count, appRoot = process.cwd() }) {
  const oneAtATime = (reason) => ({
    concurrency: 1,
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
    prepared = await prepareTestDatabases({ knexConfig, environment, count, appRoot });
  } catch (error) {
    if (!refusedPrivilege(error)) throw error;
    return oneAtATime(`the database user may not prepare ${testDatabase} (${error.code})`);
  }
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
    env: { JSKIT_TEST_DATABASES: directory },
    preload: TEST_DATABASE_FILE,
    summary: prepared.summary,
    cleanup: () => rmSync(directory, { recursive: true, force: true })
  };
}

/**
 * Runs `work` while `listen` hands each statement to the recorder it is given, and stops listening when `work` ends.
 * @template T
 * @param {(record: (query: { sql: string }) => void) => () => void} listen Starts listening; returns how to stop.
 * @param {() => Promise<T> | T} work
 * @returns {Promise<{ result: T, count: number, queries: string[] }>}
 */
async function recordStatements(listen, work) {
  const queries = [];
  const stop = listen((query) => {
    queries.push(String(query.sql));
  });
  try {
    const result = await work();
    return { result, count: queries.length, queries };
  } finally {
    stop();
  }
}

/**
 * Runs `work` and records the SQL of every statement `knex` sends meanwhile, its transactions' included (their BEGIN
 * and COMMIT among them), for a test that compares a path's statements at a few rows and at many. Pass the Knex
 * instance or transaction the work runs on; statements anything else sends through it meanwhile count too.
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
 * and neither is a server in another process. Statements the runtime sends for anything else meanwhile count too.
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

export {
  RUN_SETTINGS_FILE,
  countQueries,
  countRuntimeQueries,
  matchesSnapshot,
  prepareTestDatabases,
  requireDisposableDatabase,
  restoreTestDatabase,
  testDatabaseNames,
  testDatabaseRun,
  testDatabaseSnapshotKey
};
