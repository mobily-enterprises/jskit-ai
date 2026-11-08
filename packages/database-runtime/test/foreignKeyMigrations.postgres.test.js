import assert from "node:assert/strict";
import test from "node:test";
import knexFactory from "knex";
import {
  addMissingForeignKey,
  dropForeignKeyIfPresent,
  hasForeignKey,
  listForeignKeys
} from "../src/server/foreignKeyMigrations.js";

// Runs in a disposable PostgreSQL schema of the test database: run with DB_NAME set to TEST_DB_NAME
// (and the usual DB_HOST, DB_PORT, DB_USER and DB_PASSWORD) and DB_CLIENT unset or pg.
const TEST_DB_NAME = process.env.TEST_DB_NAME?.trim();
const ON_TEST_DATABASE = Boolean(TEST_DB_NAME) && process.env.DB_NAME === TEST_DB_NAME;
const POSTGRES_CLIENT = !process.env.DB_CLIENT || process.env.DB_CLIENT === "pg";
const SKIP = ON_TEST_DATABASE && POSTGRES_CLIENT ? false : "not on a PostgreSQL test database (DB_NAME=$TEST_DB_NAME)";

const KEY = { tableName: "children", columnName: "parent_id", parentTable: "parents", onDelete: "SET NULL" };

async function testDatabase(t) {
  const schema = `foreign_key_test_${process.pid}_${Date.now()}`;
  const connection = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: TEST_DB_NAME
  };
  const admin = knexFactory({ client: "pg", connection });
  await admin.raw("create schema ??", [schema]);
  const knex = knexFactory({ client: "pg", connection, searchPath: [schema] });
  t.after(async () => {
    await knex.destroy();
    await admin.raw("drop schema ?? cascade", [schema]);
    await admin.destroy();
  });
  await knex.schema.createTable("parents", (table) => table.integer("id").primary());
  await knex.schema.createTable("children", (table) => {
    table.increments("id");
    table.integer("parent_id").nullable();
  });
  await knex("parents").insert({ id: 1 });
  await knex("children").insert([{ parent_id: 1 }, { parent_id: null }]);
  return knex;
}

async function keyCount(knex) {
  const { rows } = await knex.raw(
    "SELECT count(*) AS keys FROM pg_constraint WHERE contype = 'f' AND conrelid = to_regclass('children')"
  );
  return Number(rows[0].keys);
}

test("addMissingForeignKey on PostgreSQL adds a missing key once, refuses rows without a parent and deletes nothing", { skip: SKIP }, async (t) => {
  const knex = await testDatabase(t);

  assert.equal(await addMissingForeignKey(knex, KEY), true);
  assert.equal(await hasForeignKey(knex, KEY), true);
  assert.equal(await addMissingForeignKey(knex, KEY), false);
  assert.equal(await keyCount(knex), 1);

  assert.equal(await dropForeignKeyIfPresent(knex, KEY), true);
  assert.equal(await dropForeignKeyIfPresent(knex, KEY), false);
  assert.equal(await keyCount(knex), 0);

  await knex("children").insert({ parent_id: 9 });
  await assert.rejects(
    addMissingForeignKey(knex, KEY),
    /children\.parent_id foreign key to parents\.id: 1 children row\(s\) have a parent_id with no parents row/u
  );
  assert.equal((await knex("children")).length, 3);
  assert.equal(await keyCount(knex), 0);

  await assert.rejects(
    addMissingForeignKey(knex, { ...KEY, parentTable: "guardians" }),
    /children\.parent_id foreign key: the guardians table does not exist/u
  );
});

test("PostgreSQL foreign key helpers find and drop a key by the name the database holds", { skip: SKIP }, async (t) => {
  const knex = await testDatabase(t);
  await knex.raw(
    "ALTER TABLE children ADD CONSTRAINT children_parent_link FOREIGN KEY (parent_id) REFERENCES parents (id)"
  );

  assert.equal(await hasForeignKey(knex, KEY), true);
  assert.equal(await addMissingForeignKey(knex, KEY), false);
  assert.equal(await keyCount(knex), 1);

  assert.equal(await dropForeignKeyIfPresent(knex, KEY), true);
  assert.equal(await keyCount(knex), 0);
  assert.equal(await hasForeignKey(knex, KEY), false);
});

test("listForeignKeys on PostgreSQL answers the schema's keys, each column of a key in order", { skip: SKIP }, async (t) => {
  const knex = await testDatabase(t);
  await knex.raw("ALTER TABLE children ADD CONSTRAINT children_parent_link FOREIGN KEY (parent_id) REFERENCES parents (id)");
  await knex.schema.createTable("pairs", (table) => {
    table.integer("a");
    table.integer("b");
    table.primary(["a", "b"]);
  });
  await knex.schema.createTable("pair_links", (table) => {
    table.integer("pair_b");
    table.integer("pair_a");
    table.foreign(["pair_b", "pair_a"], "pair_links_pair_fk").references(["b", "a"]).inTable("pairs");
  });

  assert.deepEqual(await listForeignKeys(knex), [
    { name: "children_parent_link", tableName: "children", columns: ["parent_id"], referencedTableName: "parents", referencedColumns: ["id"] },
    { name: "pair_links_pair_fk", tableName: "pair_links", columns: ["pair_b", "pair_a"], referencedTableName: "pairs", referencedColumns: ["b", "a"] }
  ]);
});
