import assert from "node:assert/strict";
import test from "node:test";
import knexFactory from "knex";
import { requireTestDatabase } from "../src/server/testDatabases.js";
import { migrateInExistingCollation } from "../src/server/tableCollationMigrations.js";

// migrateInExistingCollation's refusals and conversions on MariaDB/MySQL, each in a database of the test's own whose
// default collation is not its tables'. Local auth's migration test (auth-provider-local-db-core) runs it through
// Knex's migrator on the states a refused key left.

const TABLES_COLLATION = "utf8mb4_general_ci";
const OTHER_DEFAULT = "utf8mb4_unicode_ci";
const KEY = { tableName: "children", columnName: "parent_id", parentTable: "parents", name: "fk_children_parent", onDelete: "CASCADE" };

/**
 * A database of the test's own, named after TEST_DB_NAME with the suffix and dropped after the test, its default
 * OTHER_DEFAULT, with a `parents` table in TABLES_COLLATION.
 * @param {import("node:test").TestContext} context
 * @param {string} suffix
 */
async function openDatabase(context, suffix) {
  const name = `${requireTestDatabase(process.env)}_${suffix}`;
  const server = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD };
  const admin = knexFactory({ client: "mysql2", connection: server, pool: { min: 0, max: 1 } });
  await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
  await admin.raw(`CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE ${OTHER_DEFAULT}`, [name]);
  const knex = knexFactory({ client: "mysql2", connection: { ...server, database: name }, pool: { min: 0, max: 1 } });
  context.after(async () => {
    try {
      await knex.destroy();
      await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
    } finally {
      await admin.destroy();
    }
  });
  await knex.raw(`CREATE TABLE parents (id VARCHAR(80) PRIMARY KEY) CHARACTER SET utf8mb4 COLLATE ${TABLES_COLLATION}`);
  await knex("parents").insert({ id: "p1" });
  return knex;
}

/** Records the migration as Knex does. */
async function record(knex, name) {
  await knex.schema.createTable("knex_migrations", (table) => {
    table.increments("id");
    table.string("name");
    table.integer("batch");
    table.timestamp("migration_time");
  });
  await knex("knex_migrations").insert({ name, batch: 1, migration_time: knex.fn.now() });
}

async function collationOf(knex, tableName) {
  const [[row]] = await knex.raw(
    "SELECT TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [tableName]
  );
  return row?.collation;
}

// The released migration: a child table with a key to `parents`, created unless it exists.
async function createChildren(knex) {
  if (await knex.schema.hasTable("children")) return;
  await knex.schema.createTable("children", (table) => {
    table.string("id", 80).primary();
    table.string("parent_id", 80).notNullable();
    table.text("note").nullable();
    table.foreign(["parent_id"], KEY.name).references(["id"]).inTable("parents").onDelete("CASCADE");
  });
}

const options = { migration: "children.cjs", up: createChildren, tables: ["children"], referenceTables: ["parents"], foreignKeys: [KEY] };

test("a new table takes its reference table's collation, so its key to it is accepted", async (context) => {
  const knex = await openDatabase(context, "tcm_create");
  await assert.rejects(createChildren(knex), /errno: 150|incorrectly formed/u, "the database's default is refused");
  await knex.schema.dropTable("children");

  await migrateInExistingCollation(knex, options);

  assert.equal(await collationOf(knex, "children"), TABLES_COLLATION);
  await knex("children").insert({ id: "c1", parent_id: "p1" });
  await knex("parents").where({ id: "p1" }).delete();
  assert.deepEqual(await knex("children").select("id"), [], "the key cascades");
});

test("an unrecorded table left without its key is refused while it holds rows, and changes nothing", async (context) => {
  const knex = await openDatabase(context, "tcm_rows");
  await knex.raw(`CREATE TABLE children (id VARCHAR(80) PRIMARY KEY, parent_id VARCHAR(80) NOT NULL) COLLATE ${OTHER_DEFAULT}`);
  await knex("children").insert({ id: "c1", parent_id: "p1" });

  await assert.rejects(migrateInExistingCollation(knex, options), /children holds rows but has no foreign key to parents, and children\.cjs has not run/u);

  assert.equal(await collationOf(knex, "children"), OTHER_DEFAULT);
  assert.deepEqual(await knex("children").select("id", "parent_id"), [{ id: "c1", parent_id: "p1" }]);
});

test("a recorded table is converted when its characters fit, and refused, unchanged, when they may not", async (context) => {
  const knex = await openDatabase(context, "tcm_convert");
  await record(knex, "children.cjs");
  await knex.raw(`CREATE TABLE children (id VARCHAR(80) PRIMARY KEY, parent_id VARCHAR(80) NOT NULL, note TEXT) CHARACTER SET latin1`);
  await knex("children").insert({ id: "c1", parent_id: "p1", note: "café" });

  await migrateInExistingCollation(knex, options);

  assert.equal(await collationOf(knex, "children"), TABLES_COLLATION, "latin1 text fits utf8mb4");
  assert.deepEqual(await knex("children").select("note"), [{ note: "café" }]);
  assert.deepEqual(await knex.raw("SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = ?", [KEY.name]).then(([rows]) => rows.length), 1, "the missing key is added");

  await knex.raw("CREATE TABLE narrow_parents (id VARCHAR(80) PRIMARY KEY) CHARACTER SET latin1");
  await knex.raw(`CREATE TABLE wide (id VARCHAR(80) PRIMARY KEY) CHARACTER SET utf8mb4 COLLATE ${OTHER_DEFAULT}`);
  await knex("wide").insert({ id: "😀" });
  await assert.rejects(
    migrateInExistingCollation(knex, { migration: "children.cjs", up: createChildren, tables: ["wide"], referenceTables: ["narrow_parents"] }),
    /Cannot convert wide from utf8mb4_unicode_ci to latin1_swedish_ci: it holds rows in utf8mb4/u
  );
  assert.equal(await collationOf(knex, "wide"), OTHER_DEFAULT);
  assert.deepEqual(await knex("wide").select("id"), [{ id: "😀" }]);
});

test("everything in place and matching changes nothing, and other databases are left to the released migration", async (context) => {
  const knex = await openDatabase(context, "tcm_match");
  await record(knex, "children.cjs");
  await knex.raw(`CREATE TABLE children (id VARCHAR(80) PRIMARY KEY, parent_id VARCHAR(80) NOT NULL,
    CONSTRAINT ${KEY.name} FOREIGN KEY (parent_id) REFERENCES parents (id) ON DELETE CASCADE) COLLATE ${TABLES_COLLATION}`);
  const statements = [];
  knex.on("query", ({ sql }) => statements.push(sql));

  await migrateInExistingCollation(knex, options);

  assert.deepEqual(statements.filter((sql) => !/^\s*select\b/iu.test(sql)), [], "only reads");

  const sqlite = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  context.after(() => sqlite.destroy());
  let ran = false;
  await migrateInExistingCollation(sqlite, { ...options, up: async () => { ran = true; } });
  assert.equal(ran, false, "the released migration runs itself after its companion");
});
