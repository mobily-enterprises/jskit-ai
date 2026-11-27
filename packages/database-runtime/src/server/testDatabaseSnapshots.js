// How each dialect keeps a test run's schema snapshot and restores a test database from it (testDatabases.js prepares
// the run's databases with them):
//
// - MySQL and MariaDB: a prepared database, `<name>_0`, that each copy's tables are made from on the server: each one's
//   SHOW CREATE TABLE, then INSERT ... SELECT of its rows. A restore replaces only the tables that differ from it,
//   found by definition and CHECKSUM TABLE, so no row passes through this process. The name's suffix has two
//   characters, as each copy's (`_1`, `_2`...), so a host that grants each database by name grants it within the same
//   length. Its label, a table of its own, names its key, the server's version, the second its build's clock was
//   stopped at, its migrations and each table's definition, columns and checksum;
// - PostgreSQL: a prepared database, `<name>_snapshot`, that every copy is created from with
//   CREATE DATABASE ... TEMPLATE (STRATEGY FILE_COPY from PostgreSQL 15).
//
// Either lives on the database server, where `npm ci` cannot remove it, one for each test database, replaced when its
// key changes.
//
// A build that fills rows from the clock (a column default, NOW(), the month, JavaScript's Date) builds other values each
// time, so the migration history proof (proveMigrationHistory()) could never match its replay with the snapshot. On
// MySQL and MariaDB each build runs with the clock stopped at the snapshot's own second, stored with it: every session's
// SQL clock (SET TIMESTAMP) and JavaScript's Date. PostgreSQL's clock cannot be stopped, so each build's time window on
// the server is stored instead, and a date or time inside it compares as "clock" (each build's against its own window);
// one outside it, such as one computed from the clock, still differs.
import { detectDialectFromClient } from "../shared/dialect.js";
import { loadKnexFactory } from "./knexFactory.js";
import { MYSQL_DATABASE_OPTIONS } from "./mysqlPackageTestDatabase.js";

// The database a PostgreSQL connection uses to create, drop and copy the test databases.
const POSTGRES_MAINTENANCE_DATABASE = "postgres";
const MYSQL_SNAPSHOT_SUFFIX = "_0";
// How many tables the restores of one preparation fill at once, each on a connection of its own, shared between the
// databases it restores at once: four 250,000-row tables filled in 19 s in turn and in 9.5 s at once (MariaDB 11.4, a
// busy test machine), and a fill past what the server's cores and disk can take only queues.
const MYSQL_FILL_CONNECTIONS = 8;
const MYSQL_LABEL_TABLE = "jskit_test_snapshot";
const MYSQL_ACCESS_DENIED = new Set(["ER_DBACCESS_DENIED_ERROR", "ER_ACCESS_DENIED_ERROR", "ER_SPECIFIC_ACCESS_DENIED_ERROR"]);
const POSTGRES_INSUFFICIENT_PRIVILEGE = "42501";
// PostgreSQL 15 and later copy a template file by file (STRATEGY FILE_COPY) instead of through the write-ahead log, the
// default there: about half the time per copy of a test schema, and less again with copies made at once.
const POSTGRES_FILE_COPY_VERSION = 150000;
// MySQL values read as text, as a failed migration history proof shows the rows that differ.
const MYSQL_TEXT_CONNECTION = Object.freeze({
  dateStrings: true,
  jsonStrings: true,
  supportBigNumbers: true,
  bigNumberStrings: true
});
const MYSQL_GENERATED_COLUMN = /\b(?:VIRTUAL|STORED|PERSISTENT) GENERATED\b/iu;
// The date and time columns whose values a PostgreSQL build can take from the clock, and how the bounds of a build's
// window, in seconds since the epoch, read as each: in the session's time zone, as now() is stored in them, and for a
// column without a zone also as this process's wall clock (localWallClock()), as a JavaScript Date written to it is.
const POSTGRES_CLOCK_TYPES = Object.freeze({
  "timestamp with time zone": { bound: "to_timestamp(?)", local: "" },
  "timestamp without time zone": { bound: "to_timestamp(?)::timestamp", local: "?::timestamp" },
  date: { bound: "to_timestamp(?)::date", local: "?::date" }
});
const POSTGRES_COLUMNS = `
  SELECT c.relname AS "table", a.attname AS name, format_type(a.atttypid, NULL) AS type
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
  ORDER BY c.relname, a.attnum`;
const SNAPSHOT_LABEL = /^jskit-test-snapshot ([0-9a-f]+) (\d+) (\d+)$/u;
const SYSTEM_DATE = globalThis.Date;
let dateStopped = 0;
// Each table, view and sequence of the current schema, by name, with its definition: a table's columns in order (type,
// NOT NULL, default), its constraints and its indexes; a view's query; a sequence's type, bounds and last value.
const POSTGRES_DEFINITIONS = `
  SELECT c.relname AS name, c.relkind::text AS kind, concat_ws(E'\\n',
    (SELECT string_agg(format('%s %s%s%s', a.attname, format_type(a.atttypid, a.atttypmod),
        CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END, ' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid)), ', ' ORDER BY a.attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
    (SELECT string_agg(pg_get_constraintdef(o.oid), '; ' ORDER BY pg_get_constraintdef(o.oid)) FROM pg_constraint o WHERE o.conrelid = c.oid),
    (SELECT string_agg(pg_get_indexdef(i.indexrelid), '; ' ORDER BY pg_get_indexdef(i.indexrelid)) FROM pg_index i WHERE i.indrelid = c.oid),
    CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid) END) AS definition
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p', 'v', 'm')
  UNION ALL
  SELECT sequencename, 'S', concat_ws(' ', data_type, start_value, min_value, max_value, increment_by, cycle, last_value)
  FROM pg_sequences WHERE schemaname = current_schema()`;

const ledgerOf = (knexConfig) => knexConfig.migrations?.tableName || "knex_migrations";

/** A Knex on `database`; a MySQL `session` statement runs on each connection it opens, after the configuration's own. */
function knexOn(knexConfig, database, connectionOptions = {}, session = "", connections = 1) {
  // The configuration's own pool settings stay, such as a PostgreSQL session's UTC time zone.
  const pool = { ...knexConfig.pool, min: 0, max: connections };
  if (session) {
    const own = knexConfig.pool?.afterCreate;
    const run = (connection, done) => connection.query(session, (error) => done(error, connection));
    pool.afterCreate = own
      ? (connection, done) => own(connection, (error) => (error ? done(error, connection) : run(connection, done)))
      : run;
  }
  return loadKnexFactory()({ ...knexConfig, connection: { ...knexConfig.connection, ...connectionOptions, database }, pool });
}

/**
 * The wall-clock time of `seconds` since the epoch in this process's time zone, which node-postgres sends a JavaScript
 * Date as (with its offset, which a column without a zone drops): `2026-11-27 14:55:36`.
 */
function localWallClock(seconds) {
  const date = new SYSTEM_DATE(seconds * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Runs `work` with JavaScript's clock (new Date(), Date(), Date.now()) stopped at `milliseconds`. */
async function withDateStopped(milliseconds, work) {
  dateStopped += 1;
  globalThis.Date = new Proxy(SYSTEM_DATE, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length > 0 ? args : [milliseconds], newTarget),
    apply: () => new SYSTEM_DATE(milliseconds).toString(),
    get: (target, property, receiver) => (property === "now" ? () => milliseconds : Reflect.get(target, property, receiver))
  });
  try {
    return await work();
  } finally {
    dateStopped -= 1;
    if (dateStopped === 0) globalThis.Date = SYSTEM_DATE;
  }
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
 * Awaits every promise, and then throws the first failure, if any: a step run on each test database at once ends on
 * all of them before a failure on one ends the preparation, so none still runs after it.
 * @param {Promise<unknown>[]} promises
 */
async function settleAll(promises) {
  const results = await Promise.allSettled(promises);
  const failed = results.find(({ status }) => status === "rejected");
  if (failed) throw failed.reason;
  return results.map(({ value }) => value);
}

/**
 * What differs in `table` between a replay's rows and the snapshot's, each list a table's rows as read (null when the
 * database lacks the table), the first three of each side shown.
 */
function rowDifference(table, built, captured) {
  if (!built) return `${table}: only in the snapshot`;
  if (!captured) return `${table}: only in the replay`;
  const left = new Map();
  for (const row of captured) left.set(row, (left.get(row) ?? 0) + 1);
  const onlyBuilt = built.filter((row) => {
    const count = left.get(row);
    if (count) left.set(row, count - 1);
    return !count;
  });
  const onlyCaptured = [...left].flatMap(([row, count]) => Array(count).fill(row));
  if (onlyBuilt.length === 0 && onlyCaptured.length === 0) return `${table}: the same rows, another definition`;
  const listed = (rows) => rows.slice(0, 3).map((row) => (row.length > 200 ? `${row.slice(0, 200)}...` : row)).join(", ") +
    (rows.length > 3 ? ", ..." : "");
  return `${table}: ${onlyBuilt.length} row(s) only in the replay (${listed(onlyBuilt)}) and ${onlyCaptured.length} only in ` +
    `the snapshot (${listed(onlyCaptured)})`;
}

async function ledgerNames(knex, ledger, tables) {
  if (!tables.includes(ledger)) return [];
  const result = await knex.raw("SELECT name FROM ?? ORDER BY id", [ledger]);
  return (detectDialectFromClient(knex) === "postgres" ? result.rows : result[0]).map(({ name }) => name);
}

const mysql = {
  unstopped: "a random value, what the server holds, or a clock the build does not stop: it stops the SQL clock (NOW(), " +
    "CURRENT_TIMESTAMP, column defaults) and JavaScript's Date at the snapshot's own second, but not SYSDATE()",

  // The base tables of `database`, sorted: a snapshot database's label table aside.
  async tables(knex, database) {
    const [rows] = await knex.raw("SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES " +
      "WHERE TABLE_SCHEMA = ? AND TABLE_NAME <> ?", [database, MYSQL_LABEL_TABLE]);
    if (rows.some(({ type }) => type !== "BASE TABLE")) throw new Error(`${database} holds a view; test databases hold tables only.`);
    return rows.map(({ name }) => name).sort();
  },

  /** CHECKSUM TABLE of each of `names` in `database`, by name: the server reads the rows, and none reaches this process. */
  async checksums(knex, database, names) {
    if (names.length < 1) return new Map();
    const [rows] = await knex.raw(`CHECKSUM TABLE ${names.map(() => "??.??").join(", ")}`, names.flatMap((name) => [database, name]));
    return new Map(rows.map((row) => [row.Table.slice(database.length + 1), String(row.Checksum)]));
  },

  /**
   * Drops the tables `names` lists that `database` holds, then creates those of them the snapshot has, from its
   * definitions, on the pool's one connection, so FOREIGN_KEY_CHECKS applies to every statement: a table another one's
   * foreign key references is dropped and created again, and the key holds again once it is. Then copies their rows
   * from the snapshot database on the server (INSERT ... SELECT, generated columns left to the server), up to
   * `connections` tables at once, each on a connection of its own without foreign key checks, and samples those that
   * hold rows (analyze()).
   */
  async replaceTables(knexConfig, knex, database, names, snapshot, connections = MYSQL_FILL_CONNECTIONS) {
    const [[actual]] = await knex.raw("SELECT DATABASE() AS name");
    if (actual.name !== database) throw new Error(`A test database restore requires a connection to ${database}.`);
    const existing = new Set(await mysql.tables(knex, database));
    const replaced = (snapshot?.definitions ?? []).filter(({ name }) => names.includes(name));
    await knex.raw("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const name of names) if (existing.has(name)) await knex.raw("DROP TABLE ??", [name]);
      for (const { create } of replaced) await knex.raw(create);
    } finally {
      await knex.raw("SET FOREIGN_KEY_CHECKS = 1");
    }
    if (replaced.length < 1) return;
    // The pool opens a connection for each table it fills at once, and queues the rest.
    const fill = knexOn(knexConfig, database, {}, "SET FOREIGN_KEY_CHECKS = 0", Math.min(connections, replaced.length));
    try {
      await settleAll(replaced.map(({ name, columns }) => {
        const list = columns.map(() => "??").join(", ");
        return fill.raw(`INSERT INTO ?? (${list}) SELECT ${list} FROM ??.??`, [name, ...columns, ...columns, snapshot.database, name]);
      }));
    } finally {
      await fill.destroy();
    }
    // An empty table's CHECKSUM TABLE is 0, and its statistics, taken when it was created, already hold.
    await mysql.analyze(knex, replaced.filter(({ checksum }) => checksum !== "0").map(({ name }) => name));
  },

  /**
   * Samples `names` again for the planner, in one ANALYZE TABLE. InnoDB keeps the statistics it took when a table was
   * created, so a table created and then filled reads as empty until the server samples it again, seconds later at
   * best: the planner would read a whole table where an index serves (whs2: 356 s, 34 s once sampled).
   */
  async analyze(knex, names) {
    if (names.length < 1) return;
    const [results] = await knex.raw(`ANALYZE TABLE ${names.map(() => "??").join(", ")}`, names);
    const failed = results.find((result) => String(result.Msg_type).toLowerCase() === "error");
    if (failed) throw new Error(`ANALYZE TABLE ${failed.Table} failed: ${failed.Msg_text}`);
  },

  /** Samples every table of `database` again (analyze()), as after a seed filled some. */
  async refreshStatistics(knex, database) {
    await mysql.analyze(knex, await mysql.tables(knex, database));
  },

  /**
   * The tables of `database` that differ from the snapshot's `definitions`, sorted, each found exactly: one missing, or
   * one the snapshot lacks; one whose SHOW CREATE TABLE differs, its definition or its AUTO_INCREMENT counter (which a
   * row written and deleted, or a write rolled back, moves); one a trigger is on; one whose CHECKSUM TABLE is not the
   * snapshot's.
   */
  async changedTables(knex, database, definitions) {
    const present = new Set(await mysql.tables(knex, database));
    const captured = new Set(definitions.map(({ name }) => name));
    const changed = new Set([...present, ...captured].filter((name) => !present.has(name) || !captured.has(name)));
    const [triggers] = await knex.raw("SELECT EVENT_OBJECT_TABLE AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?",
      [database]);
    for (const { name } of triggers) changed.add(name);
    const unchanged = () => definitions.filter(({ name }) => !changed.has(name));
    for (const { name, create } of unchanged()) {
      const [[definition]] = await knex.raw("SHOW CREATE TABLE ??", [name]);
      if (definition["Create Table"] !== create) changed.add(name);
    }
    const checksums = await mysql.checksums(knex, database, unchanged().map(({ name }) => name));
    for (const { name, checksum } of unchanged()) if (checksums.get(name) !== checksum) changed.add(name);
    return [...changed].sort();
  },

  /** Each table of the snapshot database: its definition, the columns a copy fills, and its rows' checksum. */
  async describe(knex, database) {
    // SHOW CREATE TABLE carries neither, so a copy would silently lack them.
    const [[{ triggers, routines, events }]] = await knex.raw(
      "SELECT (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?) AS triggers, " +
        "(SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?) AS routines, " +
        "(SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?) AS events",
      [database, database, database]
    );
    if (Number(triggers) + Number(routines) + Number(events) > 0) {
      throw new Error(`${database} holds triggers, routines or events; MySQL test databases copied from a snapshot hold tables only.`);
    }
    const [columns] = await knex.raw("SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, EXTRA AS extra FROM " +
      "information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION", [database]);
    const names = await mysql.tables(knex, database);
    const checksums = await mysql.checksums(knex, database, names);
    const definitions = [];
    for (const name of names) {
      const [[definition]] = await knex.raw("SHOW CREATE TABLE ??", [name]);
      const filled = columns.filter((column) => column.tableName === name && !MYSQL_GENERATED_COLUMN.test(column.extra))
        .map((column) => column.name);
      definitions.push({ name, create: definition["Create Table"], columns: filled, checksum: checksums.get(name) });
    }
    return definitions;
  },

  /** The label of the snapshot database `database`, or null without one: the database missing, or its build unfinished. */
  async label(knexConfig, database) {
    return withKnex(knexConfig, undefined, async (knex) => {
      const [tables] = await knex.raw("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
        [database, MYSQL_LABEL_TABLE]);
      if (tables.length < 1) return null;
      const [[row]] = await knex.raw("SELECT label FROM ??.??", [database, MYSQL_LABEL_TABLE]);
      return row ? JSON.parse(row.label) : null;
    });
  },

  /**
   * The snapshot database, `<name>_0`, built again unless its label names this key and the server's version: a server
   * upgraded since may write, or accept, another SHOW CREATE TABLE.
   */
  async ensureSnapshot(knexConfig, database, key, build) {
    const snapshotDatabase = `${database}${MYSQL_SNAPSHOT_SUFFIX}`;
    const version = await withKnex(knexConfig, undefined, async (knex) => (await knex.raw("SELECT VERSION() AS version"))[0][0].version);
    const stored = await mysql.label(knexConfig, snapshotDatabase);
    const snapshot = ({ clock, migrations, definitions }, replayed) => ({ key, database: snapshotDatabase, clock, migrations,
      tables: definitions.map(({ name }) => name), definitions, replayed });
    if (stored?.key === key && stored.version === version) return snapshot(stored, false);
    const clock = Math.floor(Date.now() / 1000);
    await withKnex(knexConfig, undefined, async (knex) => {
      try {
        await knex.raw("DROP DATABASE IF EXISTS ??", [snapshotDatabase]);
        await knex.raw(`CREATE DATABASE ?? ${MYSQL_DATABASE_OPTIONS}`, [snapshotDatabase]);
      } catch (error) {
        if (!MYSQL_ACCESS_DENIED.has(error.code)) throw error;
        throw Object.assign(new Error(`it may not create ${snapshotDatabase}, the database that holds the run's snapshot; ` +
          `grant it all privileges on ${snapshotDatabase} by name, as on ${database} and its copies`), { code: error.code });
      }
    });
    await mysql.build(knexConfig, snapshotDatabase, clock, build);
    const { migrations } = await mysql.outline(knexConfig, snapshotDatabase);
    const label = await withKnex(knexConfig, snapshotDatabase, async (knex) => {
      const definitions = await mysql.describe(knex, snapshotDatabase);
      // Written last: a build that never finished leaves no label, and is built again.
      await knex.raw("CREATE TABLE ?? (label LONGTEXT NOT NULL)", [MYSQL_LABEL_TABLE]);
      await knex(MYSQL_LABEL_TABLE).insert({ label: JSON.stringify({ key, version, clock, migrations, definitions }) });
      return { clock, migrations, definitions };
    });
    return snapshot(label, true);
  },

  /**
   * Runs `use` on a Knex on `database` with the clock stopped at `clock`, in seconds since the epoch: the SQL clock of
   * each session it opens (SET TIMESTAMP: NOW(), CURRENT_TIMESTAMP, column defaults, CURDATE()), and JavaScript's Date.
   */
  async build(knexConfig, database, clock, use) {
    const knex = knexOn(knexConfig, database, {}, `SET TIMESTAMP = ${Number(clock)}`);
    try {
      return await withDateStopped(clock * 1000, () => use(knex));
    } finally {
      await knex.destroy();
    }
  },

  /** A replay of the history into `database`, on the snapshot's own clock. */
  async replay(knexConfig, database, snapshot, use) {
    return { result: await mysql.build(knexConfig, database, snapshot.clock, use) };
  },

  /** Each of `tables` of `database` as rows read as text, or null when `database` lacks it: what a failure shows. */
  async rows(knexConfig, database, tables) {
    return withKnex(knexConfig, database, async (knex) => {
      const present = new Set(await mysql.tables(knex, database));
      const rows = new Map();
      for (const name of tables) {
        rows.set(name, present.has(name) ? (await knex.raw("SELECT * FROM ??", [name]))[0].map((row) => JSON.stringify(row)) : null);
      }
      return rows;
    }, MYSQL_TEXT_CONNECTION);
  },

  /** Creates `database` unless it exists; false when the database user may not create it. */
  async createDatabase(knexConfig, database) {
    return withKnex(knexConfig, undefined, async (knex) => {
      try {
        await knex.raw(`CREATE DATABASE IF NOT EXISTS ?? ${MYSQL_DATABASE_OPTIONS}`, [database]);
        return true;
      } catch (error) {
        if (MYSQL_ACCESS_DENIED.has(error.code)) return false;
        throw error;
      }
    });
  },

  /** Empties `database`, every table of it dropped, and creates it when missing. */
  async clear(knexConfig, database) {
    await mysql.createDatabase(knexConfig, database);
    await withKnex(knexConfig, database, async (knex) =>
      mysql.replaceTables(knexConfig, knex, database, await mysql.tables(knex, database), null));
  },

  /**
   * The tables of `database` that differ from the snapshot's, found as a restore finds them (changedTables()), except
   * the migration ledger, whose rows hold when each migration ran.
   */
  async differences(knexConfig, database, snapshot) {
    const changed = await withKnex(knexConfig, database, (knex) => mysql.changedTables(knex, database, snapshot.definitions));
    return changed.filter((name) => name !== ledgerOf(knexConfig));
  },

  /**
   * Replaces the tables of `database` that differ from the snapshot's (changedTables()), filling up to `connections` at
   * once, and answers their names.
   */
  async restore(knexConfig, database, snapshot, connections = MYSQL_FILL_CONNECTIONS) {
    // A test may have dropped the whole database; one the user may not create but that exists is restored in place.
    await mysql.createDatabase(knexConfig, database);
    return withKnex(knexConfig, database, async (knex) => {
      const changed = await mysql.changedTables(knex, database, snapshot.definitions);
      await mysql.replaceTables(knexConfig, knex, database, changed, snapshot, connections);
      return changed;
    });
  },

  /**
   * Creates each of `databases` the server lacks, as far as the user may, and restores each (restore()): one an earlier
   * run left is changed only where its files wrote. Answers those it provides and how many tables their restores
   * copied.
   */
  async provide(knexConfig, databases, snapshot) {
    const provided = [];
    for (const [index, database] of databases.entries()) {
      // The designated database may exist already for a user who cannot create databases.
      if (!(await mysql.createDatabase(knexConfig, database)) && index > 0) break;
      provided.push(database);
    }
    // The databases restored at once share the fill's connections.
    const connections = Math.max(1, Math.floor(MYSQL_FILL_CONNECTIONS / provided.length));
    const replaced = await settleAll(provided.map((database) => mysql.restore(knexConfig, database, snapshot, connections)));
    return { databases: provided, restored: replaced.reduce((sum, tables) => sum + tables.length, 0) };
  },

  async outline(knexConfig, database) {
    return withKnex(knexConfig, database, async (knex) => {
      const tables = await mysql.tables(knex, database);
      return { tables, migrations: await ledgerNames(knex, ledgerOf(knexConfig), tables) };
    });
  }
};

const postgres = {
  unstopped: "a random value, what the server holds, or the clock: PostgreSQL's clock cannot be frozen, so a date or time " +
    "a build took from it as it was (now(), CURRENT_TIMESTAMP, CURRENT_DATE, new Date()) compares equal, but not one " +
    "computed from it, such as now() + interval '1 day' or the month's first day",

  // Tables and views alike: a copy made from the template database carries everything the migrations made.
  async tables(knex) {
    const { rows } = await knex.raw("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()");
    return rows.map(({ name }) => name).sort();
  },

  maintenance(knexConfig, use) {
    return withKnex(knexConfig, POSTGRES_MAINTENANCE_DATABASE, use);
  },

  /**
   * Samples every table of the knex's database for the planner, in one ANALYZE: a table no ANALYZE has read has no
   * column statistics until autovacuum reaches it, and a copy of a template takes the template's.
   */
  async refreshStatistics(knex) {
    const { rows } = await knex.raw("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = " +
      "current_schema() AND table_type = 'BASE TABLE'");
    if (rows.length > 0) await knex.raw(`ANALYZE ${rows.map(() => "??").join(", ")}`, rows.map(({ name }) => name));
  },

  /**
   * The snapshot database, built again unless its label names this key and the window its build ran in (one built before
   * builds recorded it names none).
   */
  async ensureSnapshot(knexConfig, database, key, build) {
    const snapshotDatabase = `${database}_snapshot`;
    const current = await postgres.maintenance(knexConfig, async (knex) => {
      const { rows } = await knex.raw(
        "SELECT shobj_description(oid, 'pg_database') AS label FROM pg_database WHERE datname = ?", [snapshotDatabase]
      );
      return rows[0]?.label || "";
    });
    const [, labelKey, start, end] = SNAPSHOT_LABEL.exec(current) ?? [];
    let window = [Number(start), Number(end)];
    const replayed = labelKey !== key;
    if (replayed) {
      await postgres.maintenance(knexConfig, async (knex) => {
        await knex.raw("DROP DATABASE IF EXISTS ??", [snapshotDatabase]);
        await knex.raw("CREATE DATABASE ??", [snapshotDatabase]);
      });
      ({ window } = await postgres.replay(knexConfig, snapshotDatabase, null, build));
      // Sampled once here, every copy of the template takes its statistics.
      await withKnex(knexConfig, snapshotDatabase, (knex) => postgres.refreshStatistics(knex));
      // The key is hexadecimal and the window integers, so they are safe inline; COMMENT takes no bound parameters.
      await postgres.maintenance(knexConfig, (knex) => knex.raw(
        `COMMENT ON DATABASE ?? IS 'jskit-test-snapshot ${key} ${window[0]} ${window[1]}'`, [snapshotDatabase]));
    }
    // Read, then closed: a template database is copied only while nothing is connected to it.
    const { tables, migrations } = await postgres.outline(knexConfig, snapshotDatabase);
    return { key, database: snapshotDatabase, migrations, tables, window, replayed };
  },

  /**
   * Runs `use` on a Knex on `database`, and answers what it answers and the window it ran in, whole seconds since the
   * epoch, wide enough for the server's clock and this process's (which a migration's new Date() reads).
   */
  async replay(knexConfig, database, _snapshot, use) {
    const now = async () => [Date.now() / 1000, await postgres.maintenance(knexConfig, async (knex) =>
      Number((await knex.raw("SELECT extract(epoch FROM clock_timestamp()) AS now")).rows[0].now))];
    const started = await now();
    const result = await withKnex(knexConfig, database, use);
    const ended = await now();
    return { result, window: [Math.floor(Math.min(...started)), Math.ceil(Math.max(...ended))] };
  },

  /**
   * Each table's rows as text for the knex on its database, in a statement per table: a date or time inside `window`
   * reads as "clock", since a build filled it from its own clock; without a window, or for a view, each row as it is.
   * @returns {Promise<Map<string, { sql: string, bindings: unknown[] }>>}
   */
  async rowTexts(knex, window) {
    const columns = new Map();
    for (const { table, name, type } of (await knex.raw(POSTGRES_COLUMNS)).rows) {
      columns.set(table, [...(columns.get(table) ?? []), { name, type }]);
    }
    const texts = new Map();
    for (const [table, list] of columns) {
      if (!window || !list.some(({ type }) => POSTGRES_CLOCK_TYPES[type])) continue;
      const bindings = [];
      const values = list.map(({ name, type }) => {
        const clock = POSTGRES_CLOCK_TYPES[type];
        if (!clock) {
          bindings.push(name);
          return "t.??::text";
        }
        const { bound, local } = clock;
        bindings.push(name, window[0], window[1]);
        if (local) bindings.push(name, localWallClock(window[0]), localWallClock(window[1]));
        bindings.push(name);
        return `CASE WHEN t.?? BETWEEN ${bound} AND ${bound}${local ? ` OR t.?? BETWEEN ${local} AND ${local}` : ""} ` +
          "THEN 'clock' ELSE t.??::text END";
      });
      texts.set(table, { sql: `ROW(${values.join(", ")})::text`, bindings });
    }
    return texts;
  },

  /** Creates `database` anew, empty. */
  async clear(knexConfig, database) {
    await postgres.maintenance(knexConfig, async (knex) => {
      await knex.raw("DROP DATABASE IF EXISTS ??", [database]);
      await knex.raw("CREATE DATABASE ??", [database]);
    });
  },

  /**
   * Each table, view and sequence of `database` by name, with its definition (POSTGRES_DEFINITIONS) and, for a table or
   * view, a digest of its rows in any order (rowTexts(): a date or time inside the build's `window` reads as "clock"),
   * the migration ledger's aside: they hold when each migration ran.
   */
  async definitions(knexConfig, database, window) {
    return withKnex(knexConfig, database, async (knex) => {
      const texts = await postgres.rowTexts(knex, window);
      const definitions = new Map();
      for (const { name, kind, definition } of (await knex.raw(POSTGRES_DEFINITIONS)).rows) {
        const { sql, bindings } = texts.get(name) ?? { sql: "t::text", bindings: [] };
        const rows = kind === "S" || name === ledgerOf(knexConfig) ? "" : (await knex.raw("SELECT md5(COALESCE(string_agg(r, " +
          `E'\\n' ORDER BY r), '')) AS digest FROM (SELECT ${sql} AS r FROM ?? AS t) AS s`, [...bindings, name])).rows[0].digest;
        definitions.set(name, `${definition}\n${rows}`);
      }
      return definitions;
    });
  },

  /**
   * The tables, views and sequences of `database`, built in `window`, whose definition or rows differ from the snapshot
   * database's, each side's dates and times read against its own build's window.
   */
  async differences(knexConfig, database, snapshot, window) {
    const built = await postgres.definitions(knexConfig, database, window);
    const captured = await postgres.definitions(knexConfig, snapshot.database, snapshot.window);
    return [...new Set([...built.keys(), ...captured.keys()])].filter((name) => built.get(name) !== captured.get(name)).sort();
  },

  /** Each of `tables` of `database` as rows read as differences() reads them, or null when `database` lacks it. */
  async rows(knexConfig, database, tables, window) {
    return withKnex(knexConfig, database, async (knex) => {
      const present = new Set(await postgres.tables(knex));
      const texts = await postgres.rowTexts(knex, window);
      const rows = new Map();
      for (const name of tables) {
        const { sql, bindings } = texts.get(name) ?? { sql: "t::text", bindings: [] };
        rows.set(name, present.has(name)
          ? (await knex.raw(`SELECT ${sql} AS r FROM ?? AS t`, [...bindings, name])).rows.map(({ r }) => r) : null);
      }
      return rows;
    });
  },

  /**
   * Recreates `database` from the snapshot and answers its tables, every one of them a new copy; null when the database
   * user may not create databases. A copy of the template costs less than finding which tables differ.
   */
  async restore(knexConfig, database, snapshot) {
    return postgres.maintenance(knexConfig, async (knex) => {
      try {
        await knex.raw("DROP DATABASE IF EXISTS ??", [database]);
        const { rows: [{ server_version_num: version }] } = await knex.raw("SHOW server_version_num");
        const strategy = Number(version) >= POSTGRES_FILE_COPY_VERSION ? " STRATEGY FILE_COPY" : "";
        await knex.raw(`CREATE DATABASE ?? TEMPLATE ??${strategy}`, [database, snapshot.database]);
        return snapshot.tables;
      } catch (error) {
        if (error.code === POSTGRES_INSUFFICIENT_PRIVILEGE) return null;
        throw error;
      }
    });
  },

  /**
   * Makes each of `databases` again from the snapshot (restore()), one at a time, since each copy reads the template
   * while it is made, as far as the user may. Answers those it provides and how many tables they hold.
   */
  async provide(knexConfig, databases, snapshot) {
    const provided = [];
    let restored = 0;
    for (const database of databases) {
      const tables = await postgres.restore(knexConfig, database, snapshot);
      if (!tables) break;
      provided.push(database);
      restored += tables.length;
    }
    if (provided.length < 1) throw new Error(`The database user may not create ${databases[0]} from the snapshot (CREATEDB).`);
    return { databases: provided, restored };
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

export {
  DIALECTS,
  POSTGRES_INSUFFICIENT_PRIVILEGE,
  POSTGRES_MAINTENANCE_DATABASE,
  dialectOf,
  ledgerOf,
  rowDifference,
  settleAll,
  withKnex
};
