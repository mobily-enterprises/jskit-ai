// How each dialect keeps a test run's schema snapshot and restores a test database from it (testDatabases.js prepares
// the run's databases with them):
//
// - MySQL and MariaDB: each table's SHOW CREATE TABLE and its rows, in a file under
//   `node_modules/.cache/jskit-test-databases/` named after the snapshot's key and the server's version;
// - PostgreSQL: a prepared database, `<name>_snapshot`, that every copy is created from with
//   CREATE DATABASE ... TEMPLATE (STRATEGY FILE_COPY from PostgreSQL 15).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { detectDialectFromClient } from "../shared/dialect.js";
import { loadKnexFactory } from "./knexFactory.js";
import { MYSQL_DATABASE_OPTIONS } from "./mysqlPackageTestDatabase.js";
import { POSTGRES_MAINTENANCE_DATABASE } from "./testDatabaseCopies.js";

const SNAPSHOT_DIRECTORY = path.join("node_modules", ".cache", "jskit-test-databases");
const MYSQL_ACCESS_DENIED = new Set(["ER_DBACCESS_DENIED_ERROR", "ER_ACCESS_DENIED_ERROR", "ER_SPECIFIC_ACCESS_DENIED_ERROR"]);
const POSTGRES_INSUFFICIENT_PRIVILEGE = "42501";
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

function knexOn(knexConfig, database, connectionOptions = {}) {
  return loadKnexFactory()({
    ...knexConfig,
    connection: { ...knexConfig.connection, ...connectionOptions, database },
    // The configuration's own pool settings stay, such as a PostgreSQL session's UTC time zone.
    pool: { ...knexConfig.pool, min: 0, max: 1 }
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
 * Awaits every promise, and then throws the first failure, if any: a step run on each test database at once ends on
 * all of them before a failure on one drops the copies, which keeps any a session is still connected to.
 * @param {Promise<unknown>[]} promises
 */
async function settleAll(promises) {
  const results = await Promise.allSettled(promises);
  const failed = results.find(({ status }) => status === "rejected");
  if (failed) throw failed.reason;
  return results.map(({ value }) => value);
}

// A table's rows as read, in any order: two tables' digests are equal when their rows are.
function rowsDigest(rows) {
  return createHash("sha256").update(rows.map((row) => JSON.stringify(row)).sort().join("\n")).digest("hex");
}

async function ledgerNames(knex, ledger, tables) {
  if (!tables.includes(ledger)) return [];
  const result = await knex.raw("SELECT name FROM ?? ORDER BY id", [ledger]);
  return (detectDialectFromClient(knex) === "postgres" ? result.rows : result[0]).map(({ name }) => name);
}

const mysql = {
  async tables(knex, database) {
    const [rows] = await knex.raw(
      "SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]
    );
    if (rows.some(({ type }) => type !== "BASE TABLE")) throw new Error(`${database} holds a view; test databases hold tables only.`);
    return rows.map(({ name }) => name).sort();
  },

  /**
   * Drops the tables `names` lists that `database` holds, then creates those of them the snapshot's `tables` has, with
   * their rows. Runs on the pool's one connection, so FOREIGN_KEY_CHECKS applies to every statement: a table another
   * one's foreign key references is dropped and created again, and the key holds again once it is.
   */
  async replaceTables(knex, database, names, tables) {
    const [[actual]] = await knex.raw("SELECT DATABASE() AS name");
    if (actual.name !== database) throw new Error(`A test database restore requires a connection to ${database}.`);
    const existing = new Set(await mysql.tables(knex, database));
    const replaced = tables.filter(({ name }) => names.includes(name));
    await knex.raw("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const name of names) if (existing.has(name)) await knex.raw("DROP TABLE ??", [name]);
      for (const { create } of replaced) await knex.raw(create);
      for (const { inserts } of replaced) for (const insert of inserts) await knex.raw(insert);
    } finally {
      await knex.raw("SET FOREIGN_KEY_CHECKS = 1");
    }
  },

  /**
   * The tables of `database` that differ from the snapshot's `tables`, sorted, each found exactly: one missing, or one
   * the snapshot lacks; one whose SHOW CREATE TABLE differs, its definition or its AUTO_INCREMENT counter (which a row
   * written and deleted, or a write rolled back, moves); one a trigger is on; one empty in the snapshot that holds a
   * row; one whose rows, read as the capture read them, are not the snapshot's.
   */
  async changedTables(knex, database, tables) {
    const present = new Set(await mysql.tables(knex, database));
    const captured = new Set(tables.map(({ name }) => name));
    const changed = new Set([...present, ...captured].filter((name) => !present.has(name) || !captured.has(name)));
    const [triggers] = await knex.raw("SELECT EVENT_OBJECT_TABLE AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?",
      [database]);
    for (const { name } of triggers) changed.add(name);
    const unchanged = () => tables.filter(({ name }) => !changed.has(name));
    for (const { name, create } of unchanged()) {
      const [[definition]] = await knex.raw("SHOW CREATE TABLE ??", [name]);
      if (definition["Create Table"] !== create) changed.add(name);
    }
    // One statement for the tables the snapshot holds empty.
    const empty = unchanged().filter(({ inserts }) => inserts.length === 0);
    if (empty.length > 0) {
      const [filled] = await knex.raw(empty.map(() => "SELECT ? AS name FROM DUAL WHERE EXISTS (SELECT 1 FROM ??)").join(" UNION ALL "),
        empty.flatMap(({ name }) => [name, name]));
      for (const { name } of filled) changed.add(name);
    }
    for (const { name, digest } of unchanged().filter(({ inserts }) => inserts.length > 0)) {
      const [rows] = await knex.raw("SELECT * FROM ??", [name]);
      if (rowsDigest(rows) !== digest) changed.add(name);
    }
    return [...changed].sort();
  },

  /**
   * Each table's definition, its rows as INSERT statements (generated columns left to the server) and a digest of its
   * rows as read (rowsDigest()).
   */
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
      const digest = rowsDigest(rows);
      const generated = columns.filter((column) => column.tableName === name && MYSQL_GENERATED_COLUMN.test(column.extra))
        .map((column) => column.name);
      for (const row of rows) for (const column of generated) delete row[column];
      const inserts = [];
      for (let start = 0; start < rows.length; start += INSERT_BATCH) {
        inserts.push(knex(name).insert(rows.slice(start, start + INSERT_BATCH)).toQuery());
      }
      tables.push({ name, create: definition["Create Table"], inserts, digest });
    }
    return tables;
  },

  async ensureSnapshot(knexConfig, database, key, appRoot, build) {
    // Another server version may write, or accept, another SHOW CREATE TABLE.
    const version = await withKnex(knexConfig, undefined, async (knex) => (await knex.raw("SELECT VERSION() AS version"))[0][0].version);
    const server = createHash("sha256").update(String(version)).digest("hex").slice(0, 8);
    const file = path.join(appRoot, SNAPSHOT_DIRECTORY, `${key}-${server}.json`);
    if (existsSync(file)) {
      const { migrations, tables } = JSON.parse(readFileSync(file, "utf8"));
      return { key, file, migrations, tables: tables.map(({ name }) => name), replayed: false };
    }
    await mysql.createDatabase(knexConfig, database);
    // The schema is built on the application's own connection settings; only the capture reads values as text.
    await withKnex(knexConfig, database, async (knex) => {
      await mysql.replaceTables(knex, database, await mysql.tables(knex, database), []);
      await build(knex);
    });
    const { migrations } = await mysql.outline(knexConfig, database);
    const tables = await withKnex(knexConfig, database, (knex) => mysql.capture(knex, database), MYSQL_SNAPSHOT_CONNECTION);
    mkdirSync(path.dirname(file), { recursive: true });
    // Written whole, then renamed, so a run beside this one never reads half a snapshot.
    writeFileSync(`${file}.${process.pid}`, JSON.stringify({ migrations, tables }));
    renameSync(`${file}.${process.pid}`, file);
    return { key, file, migrations, tables: tables.map(({ name }) => name), replayed: true };
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
    await withKnex(knexConfig, database, async (knex) => mysql.replaceTables(knex, database, await mysql.tables(knex, database), []));
  },

  /**
   * The tables of `database` that differ from the snapshot's, found as a restore finds them (changedTables()), except
   * the migration ledger, whose rows hold when each migration ran.
   */
  async differences(knexConfig, database, snapshot) {
    const { tables } = JSON.parse(readFileSync(snapshot.file, "utf8"));
    const changed = await withKnex(knexConfig, database, (knex) => mysql.changedTables(knex, database, tables),
      MYSQL_SNAPSHOT_CONNECTION);
    return changed.filter((name) => name !== ledgerOf(knexConfig));
  },

  /** Replaces the tables of `database` that differ from the snapshot's (changedTables()), and answers their names. */
  async restore(knexConfig, database, snapshot) {
    const { tables } = JSON.parse(readFileSync(snapshot.file, "utf8"));
    // A test may have dropped the whole database; one the user may not create but that exists is restored in place.
    await mysql.createDatabase(knexConfig, database);
    // On the capture's connection settings, so rows read as the capture read them; they only change how values read.
    return withKnex(knexConfig, database, async (knex) => {
      const changed = await mysql.changedTables(knex, database, tables);
      await mysql.replaceTables(knex, database, changed, tables);
      return changed;
    }, MYSQL_SNAPSHOT_CONNECTION);
  },

  async provide(knexConfig, databases, snapshot) {
    const provided = [];
    for (const [index, database] of databases.entries()) {
      // The designated database may exist already for a user who cannot create databases.
      if (!(await mysql.createDatabase(knexConfig, database)) && index > 0) break;
      provided.push(database);
    }
    await settleAll(provided.map((database) => mysql.restore(knexConfig, database, snapshot)));
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

  async ensureSnapshot(knexConfig, database, key, _appRoot, build) {
    const snapshotDatabase = `${database}_snapshot`;
    const label = `jskit-test-snapshot ${key}`;
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
      await withKnex(knexConfig, snapshotDatabase, build);
      // The key is hexadecimal, so it is safe inline; COMMENT takes no bound parameters.
      await postgres.maintenance(knexConfig, (knex) => knex.raw(`COMMENT ON DATABASE ?? IS '${label}'`, [snapshotDatabase]));
    }
    // Read, then closed: a template database is copied only while nothing is connected to it.
    const { tables, migrations } = await postgres.outline(knexConfig, snapshotDatabase);
    return { key, database: snapshotDatabase, migrations, tables, replayed };
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
   * view, a digest of its rows in any order, the migration ledger's aside: they hold when each migration ran.
   */
  async definitions(knexConfig, database) {
    return withKnex(knexConfig, database, async (knex) => {
      const definitions = new Map();
      for (const { name, kind, definition } of (await knex.raw(POSTGRES_DEFINITIONS)).rows) {
        const rows = kind === "S" || name === ledgerOf(knexConfig) ? "" : (await knex.raw(
          "SELECT md5(COALESCE(string_agg(t::text, E'\\n' ORDER BY t::text), '')) AS digest FROM ?? AS t", [name])).rows[0].digest;
        definitions.set(name, `${definition}\n${rows}`);
      }
      return definitions;
    });
  },

  /** The tables, views and sequences of `database` whose definition or rows differ from the snapshot database's. */
  async differences(knexConfig, database, snapshot) {
    const built = await postgres.definitions(knexConfig, database);
    const captured = await postgres.definitions(knexConfig, snapshot.database);
    return [...new Set([...built.keys(), ...captured.keys()])].filter((name) => built.get(name) !== captured.get(name)).sort();
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

export {
  DIALECTS,
  POSTGRES_INSUFFICIENT_PRIVILEGE,
  dialectOf,
  ledgerOf,
  settleAll,
  withKnex
};
