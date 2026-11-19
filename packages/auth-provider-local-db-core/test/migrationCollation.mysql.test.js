import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import knexLib from "knex";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";

// Local auth's migrations on a MariaDB/MySQL database whose default collation is not its tables', as when a dump is
// restored onto a server with another default. Knex runs them as an application does: every file of the migrations
// directory, sorted, that it has not recorded. A released migration created its table in the database's default, so
// MariaDB refused auth_local_second_factors' key to auth_local_users (errno 150) and left the database half-migrated.

const MIGRATIONS = path.resolve(import.meta.dirname, "../migrations");
const require = createRequire(import.meta.url);
// The files an application ran before this fix: every migration but the "-collation" companions.
const RELEASED = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".cjs") && !file.endsWith("-collation.cjs")).sort();
// What an application on a catalog before 0.2.36 had run; moving to 0.2.92 then ran five more migrations and failed on
// the sixth, auth_local_db_users_second_factors.cjs.
const EARLY = Object.freeze(["auth_local_db_initial.cjs", "auth_local_db_oauth.cjs", "auth_local_db_protection.cjs"]);
const TABLES_COLLATION = "utf8mb4_general_ci";
const OTHER_DEFAULT = "utf8mb4_unicode_ci";
const SECOND_FACTOR_KEY = "fk_auth_local_second_factors_user";
// The runtime's own MySQL connection settings (database-runtime's resolveKnexConnectionFromEnvironment).
const RUNTIME_MYSQL = Object.freeze({ supportBigNumbers: true, bigNumberStrings: true, dateStrings: ["DATE"], timezone: "Z" });

/**
 * A database of the test's own, named after TEST_DB_NAME with the suffix and dropped after the test, created with the
 * collation as its default, and a Knex on it.
 * @param {import("node:test").TestContext} context
 * @param {string} suffix
 * @param {string} collation
 */
async function openDatabase(context, suffix, collation) {
  const name = `${requireTestDatabase(process.env)}_${suffix}`;
  if (name.length > 64) throw new Error(`Test database name ${name} is longer than MySQL's 64 characters.`);
  const server = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD };
  const admin = knexLib({ client: "mysql2", connection: server, pool: { min: 0, max: 1 } });
  const connect = () => knexLib({ client: "mysql2", connection: { ...server, database: name, ...RUNTIME_MYSQL }, pool: { min: 0, max: 2 } });
  await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
  await admin.raw(`CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE ${collation}`, [name]);
  let knex = connect();
  context.after(async () => {
    try {
      await knex.destroy();
      await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
    } finally {
      await admin.destroy();
    }
  });
  return Object.freeze({
    knex,
    // The database's default changes under its tables, as restoring a dump onto another server's default does. A
    // connection keeps the default it found when it chose the database, so the Knex it answers connects anew.
    async restoredWithDefault(other) {
      await admin.raw(`ALTER DATABASE ?? CHARACTER SET utf8mb4 COLLATE ${other}`, [name]);
      await knex.destroy();
      knex = connect();
      return knex;
    }
  });
}

/** Runs these released files, as an application on the release that shipped them did. */
function migrateReleased(knex, files) {
  return knex.migrate.latest({
    migrationSource: {
      getMigrations: async () => files,
      getMigrationName: (file) => file,
      getMigration: async (file) => require(path.join(MIGRATIONS, file))
    }
  });
}

/** Runs the migrations directory as it is now, with the settings createKnexMigrationConfig gives a package's. */
function migrate(knex) {
  return knex.migrate.latest({ directory: [MIGRATIONS], extension: "cjs", sortDirsSeparately: true });
}

/** Each local auth table's collation. */
async function collations(knex) {
  const [rows] = await knex.raw(
    "SELECT TABLE_NAME AS name, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'auth\\_local\\_%' ORDER BY TABLE_NAME"
  );
  return Object.fromEntries(rows.map(({ name, collation }) => [name, collation]));
}

/** The migrations Knex has recorded, sorted. */
async function recorded(knex) {
  return (await knex("knex_migrations").pluck("name")).sort();
}

/** Whether auth_local_second_factors has its key to auth_local_users. */
async function hasSecondFactorKey(knex) {
  const [rows] = await knex.raw(
    "SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = ? AND TABLE_NAME = 'auth_local_second_factors' AND REFERENCED_TABLE_NAME = 'auth_local_users'",
    [SECOND_FACTOR_KEY]
  );
  return rows.length === 1;
}

/** The whole schema of the database's tables but Knex's own: tables, columns, indexes and keys. */
async function schemaOf(knex) {
  const outsideKnex = "TABLE_SCHEMA = DATABASE() AND TABLE_NAME NOT LIKE 'knex\\_migrations%'";
  const [tables] = await knex.raw(`SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE ${outsideKnex} ORDER BY 1`);
  const [columns] = await knex.raw(
    `SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_SET_NAME, COLLATION_NAME, EXTRA
      FROM information_schema.COLUMNS WHERE ${outsideKnex} ORDER BY 1, 3`
  );
  const [indexes] = await knex.raw(
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME FROM information_schema.STATISTICS WHERE ${outsideKnex} ORDER BY 1, 2, 4`
  );
  const [keys] = await knex.raw(
    `SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY 1, 2`
  );
  return { tables, columns, indexes, keys };
}

const account = { id: "usr_ada", email: "ada@example.com", display_name: "Ada", password_algorithm: "scrypt", password_version: "1",
  password_salt: "salt", password_hash: "hash", disabled: false, created_at: "2026-11-01 08:00:00", updated_at: "2026-11-01 08:00:00" };
const usedPass = { id: "c0ffee", expires_at: "2026-12-01 08:00:00", created_at: "2026-11-01 08:00:00" };

test("each companion sorts just before the released migration it runs, as Knex sorts a directory's files", () => {
  const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".cjs")).sort();
  for (const file of files.filter((name) => name.endsWith("-collation.cjs"))) {
    assert.equal(files[files.indexOf(file) + 1], file.replace("-collation.cjs", ".cjs"), file);
  }
  assert.deepEqual(files.filter((file) => file.endsWith("-collation.cjs")).map((file) => file.replace("-collation.cjs", "")), [
    "auth_local_db_initial",
    "auth_local_db_oauth",
    "auth_local_db_protection",
    "auth_local_db_used_passes",
    "auth_local_db_users_second_factors"
  ], "every released migration that creates a table has its companion");
});

test("a database whose tables differ from its default creates each new table in its tables' collation", async (context) => {
  const database = await openDatabase(context, "coll_behind", TABLES_COLLATION);
  await migrateReleased(database.knex, EARLY);
  const knex = await database.restoredWithDefault(OTHER_DEFAULT);

  await migrate(knex);

  const tables = await collations(knex);
  assert.deepEqual(Object.keys(tables), [
    "auth_local_identities", "auth_local_oauth_attempts", "auth_local_recovery", "auth_local_registrations",
    "auth_local_second_factors", "auth_local_sessions", "auth_local_sign_in_failures", "auth_local_used_passes", "auth_local_users"
  ]);
  for (const [table, collation] of Object.entries(tables)) assert.equal(collation, TABLES_COLLATION, table);
  assert.equal(await hasSecondFactorKey(knex), true);
  assert.deepEqual(await recorded(knex), readdirSync(MIGRATIONS).filter((file) => file.endsWith(".cjs")).sort());
});

test("a database the released migrations left half-migrated recovers on the next migrate", async (context) => {
  const database = await openDatabase(context, "coll_half", TABLES_COLLATION);
  await migrateReleased(database.knex, EARLY);
  const knex = await database.restoredWithDefault(OTHER_DEFAULT);
  await assert.rejects(migrateReleased(knex, RELEASED), /errno: 150|incorrectly formed/u);

  // The state the refused key left, as dogandgroom's database measured it.
  assert.deepEqual(await recorded(knex), [
    ...EARLY,
    "auth_local_db_sessions_metadata.cjs",
    "auth_local_db_used_passes.cjs",
    "auth_local_db_users_disabled_message.cjs",
    "auth_local_db_users_email_verified.cjs",
    "auth_local_db_users_pending_email.cjs"
  ].sort());
  assert.equal((await collations(knex)).auth_local_used_passes, OTHER_DEFAULT);
  assert.equal((await collations(knex)).auth_local_second_factors, OTHER_DEFAULT);
  assert.equal(await hasSecondFactorKey(knex), false);
  assert.equal(Number((await knex("auth_local_second_factors").count({ rows: "*" }))[0].rows), 0);
  await knex("auth_local_users").insert(account);
  await knex("auth_local_used_passes").insert(usedPass);

  await migrate(knex);

  const tables = await collations(knex);
  for (const [table, collation] of Object.entries(tables)) assert.equal(collation, TABLES_COLLATION, table);
  assert.equal(await hasSecondFactorKey(knex), true, "the empty, unrecorded table is replaced with its key");
  assert.deepEqual(await knex("auth_local_used_passes").select("id"), [{ id: usedPass.id }], "the converted table keeps its row");
  assert.equal(await knex.schema.hasColumn("auth_local_sessions", "second_factor_at"), true);
  assert.deepEqual(await recorded(knex), readdirSync(MIGRATIONS).filter((file) => file.endsWith(".cjs")).sort());
});

test("a half-migrated database the released migrations then completed gets its tables converted and its key", async (context) => {
  const database = await openDatabase(context, "coll_retried", TABLES_COLLATION);
  await migrateReleased(database.knex, EARLY);
  const knex = await database.restoredWithDefault(OTHER_DEFAULT);
  await assert.rejects(migrateReleased(knex, RELEASED), /errno: 150|incorrectly formed/u);
  // A second try of the released migrations finds the table and records it, without its key.
  await migrateReleased(knex, RELEASED);
  assert.deepEqual(await recorded(knex), RELEASED);
  assert.equal((await collations(knex)).auth_local_second_factors, OTHER_DEFAULT);
  assert.equal(await hasSecondFactorKey(knex), false);
  await knex("auth_local_users").insert(account);
  await knex("auth_local_used_passes").insert(usedPass);
  await knex("auth_local_second_factors").insert({ user_id: account.id, secret_sealed: "sealed", last_used_step: 0,
    recovery_code_hashes: "", failures: 0, created_at: "2026-11-01 08:00:00", updated_at: "2026-11-01 08:00:00" });

  await migrate(knex);

  for (const [table, collation] of Object.entries(await collations(knex))) assert.equal(collation, TABLES_COLLATION, table);
  assert.equal(await hasSecondFactorKey(knex), true);
  assert.deepEqual(await knex("auth_local_second_factors").pluck("user_id"), [account.id]);
  assert.deepEqual(await knex("auth_local_used_passes").pluck("id"), [usedPass.id]);
});

test("a database whose tables match its default sees no change, and a new one gets the released schema", async (context) => {
  const { knex: migrated } = await openDatabase(context, "coll_match", TABLES_COLLATION);
  await migrateReleased(migrated, RELEASED);
  const before = await schemaOf(migrated);

  await migrate(migrated);

  assert.deepEqual(await schemaOf(migrated), before);
  assert.deepEqual(await recorded(migrated), readdirSync(MIGRATIONS).filter((file) => file.endsWith(".cjs")).sort());

  const { knex: fresh } = await openDatabase(context, "coll_fresh", TABLES_COLLATION);
  await migrate(fresh);
  assert.deepEqual(await schemaOf(fresh), before, "the companions change nothing on a new database");
});
