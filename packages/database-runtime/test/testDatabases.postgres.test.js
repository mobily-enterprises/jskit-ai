import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import knexFactory from "knex";
import { createKnexMigrationConfig } from "../src/server/knexMigrationConfig.js";
import { matchesSnapshot, prepareTestDatabases, restoreTestDatabase } from "../src/server/testDatabases.js";

// Runs beside the PostgreSQL test database: run with DB_NAME set to TEST_DB_NAME (and the usual DB_HOST, DB_PORT,
// DB_USER and DB_PASSWORD), DB_CLIENT unset or pg, and a database user that may create databases (CREATEDB).
const TEST_DB_NAME = process.env.TEST_DB_NAME?.trim();
const ON_TEST_DATABASE = Boolean(TEST_DB_NAME) && process.env.DB_NAME === TEST_DB_NAME;
const POSTGRES_CLIENT = !process.env.DB_CLIENT || process.env.DB_CLIENT === "pg";
const SKIP = ON_TEST_DATABASE && POSTGRES_CLIENT ? false : "not on a PostgreSQL test database (DB_NAME=$TEST_DB_NAME)";

const BOOKS = `exports.up = async (knex) => {
  await knex.schema.createTable("books", (table) => { table.increments("id"); table.string("title"); });
  await knex("books").insert({ title: "Written by the migration" });
};
exports.down = () => {};
`;

test("each PostgreSQL test database is a copy of the snapshot database, rebuilt only when a migration changes", {
  skip: SKIP
}, async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-pg-"));
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_books.cjs"), BOOKS);
  const name = `${TEST_DB_NAME}_copies`;
  const environment = { ...process.env, DB_CLIENT: "pg", DB_NAME: TEST_DB_NAME, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "pg", environment, appRoot });
  const on = (database) => knexFactory({ client: "pg", connection: { ...knexConfig.connection, database } });
  const names = [name, `${name}_1`];
  context.after(async () => {
    const admin = on(TEST_DB_NAME);
    try {
      for (const database of [...names, `${name}_snapshot`]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    } finally {
      await admin.destroy();
    }
    await rm(appRoot, { recursive: true, force: true });
  });
  const seed = (transaction) => transaction("books").insert({ title: "Seeded" });

  const first = await prepareTestDatabases({ knexConfig, environment, count: 2, seed, appRoot });
  assert.deepEqual(first.databases, names);
  assert.match(first.summary, /1 migrations replayed once for a new snapshot/u);
  assert.equal(first.snapshot.database, `${name}_snapshot`);
  for (const database of names) {
    const db = on(database);
    try {
      assert.deepEqual(await db("books").orderBy("id").pluck("title"), ["Written by the migration", "Seeded"], database);
    } finally {
      await db.destroy();
    }
  }

  const again = await prepareTestDatabases({ knexConfig, environment, count: 2, appRoot });
  assert.match(again.summary, /stored snapshot/u);
  const copy = on(names[1]);
  try {
    assert.deepEqual(await copy("books").pluck("title"), ["Written by the migration"]);
    await copy.schema.dropTable("books");
  } finally {
    await copy.destroy();
  }
  assert.equal(await matchesSnapshot(knexConfig, names[1], again.snapshot), false);
  await restoreTestDatabase(knexConfig, names[1], again.snapshot);
  assert.equal(await matchesSnapshot(knexConfig, names[1], again.snapshot), true);

  await writeFile(path.join(appRoot, "migrations", "20200102000000_shelves.cjs"),
    "exports.up = (knex) => knex.schema.createTable(\"shelves\", (table) => table.increments(\"id\"));\nexports.down = () => {};\n");
  const changed = await prepareTestDatabases({ knexConfig, environment, count: 1, appRoot });
  assert.match(changed.summary, /2 migrations replayed once for a new snapshot/u);
  assert.deepEqual(changed.snapshot.tables, ["books", "knex_migrations", "knex_migrations_lock", "shelves"]);
});
