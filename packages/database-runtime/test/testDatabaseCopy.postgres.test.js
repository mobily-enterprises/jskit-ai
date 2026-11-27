import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import knexFactory from "knex";
import { createKnexMigrationConfig } from "../src/server/knexMigrationConfig.js";
import { RUN_SETTINGS_FILE, claimTestDatabaseCopy, testDatabaseRun } from "../src/server/testDatabases.js";

// claimTestDatabaseCopy() on PostgreSQL. Runs beside the PostgreSQL test database: run with DB_NAME set to TEST_DB_NAME
// (and the usual DB_HOST, DB_PORT, DB_USER and DB_PASSWORD), DB_CLIENT unset or pg, and a database user that may
// create databases (CREATEDB).
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

/**
 * A run of `jskit test --databases` of two files for an application in a directory of its own, whose TEST_DB_NAME is
 * named after `suffix`, and the environment the file holding the numbered copy gets; after the test the run ends, its
 * designated database and snapshot are dropped, and the directory goes.
 * @param {import("node:test").TestContext} context
 * @param {string} suffix
 */
async function runFile(context, suffix) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), `jskit-test-database-copy-pg-${suffix}-`));
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_books.cjs"), BOOKS);
  const name = `${TEST_DB_NAME}_${suffix}`;
  const environment = { ...process.env, DB_CLIENT: "pg", DB_NAME: TEST_DB_NAME, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "pg", environment, appRoot });
  const admin = knexFactory({ client: "pg", connection: knexConfig.connection, pool: { min: 0, max: 1 } });
  const run = await testDatabaseRun({ knexConfig, environment, count: 2, appRoot });
  context.after(async () => {
    try {
      await run.cleanup();
      for (const database of [name, `${name}_snapshot`]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    } finally {
      await admin.destroy();
      await rm(appRoot, { recursive: true, force: true });
    }
  });
  const file = `${name}_1`;
  const fileEnvironment = { ...environment, DB_NAME: file, TEST_DB_NAME: file, JSKIT_DESIGNATED_TEST_DB_NAME: name,
    JSKIT_TEST_DATABASE_SETTINGS: path.join(run.env.JSKIT_TEST_DATABASES, RUN_SETTINGS_FILE) };
  /** The book titles of `database`, connected only while read. */
  const titles = async (database) => {
    const db = knexFactory({ client: "pg", connection: { ...knexConfig.connection, database }, pool: { min: 0, max: 1 } });
    try {
      return await db("books").orderBy("id").pluck("title");
    } finally {
      await db.destroy();
    }
  };
  return { name, file, admin, fileEnvironment, titles };
}

/** A test context whose teardown the test runs itself, to see what it drops. */
function teardown() {
  const cleanups = [];
  const run = async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
  };
  return { context: { after: (cleanup) => cleanups.push(cleanup) }, run };
}

test("on PostgreSQL claimTestDatabaseCopy() gives a file two more databases holding the run's snapshot, each its own, dropped in the test's teardown", {
  skip: SKIP
}, async (context) => {
  const { name, file, admin, fileEnvironment, titles } = await runFile(context, "copy1");
  const scratch = teardown();
  const copies = await Promise.all([
    claimTestDatabaseCopy(scratch.context, { environment: fileEnvironment }),
    claimTestDatabaseCopy(scratch.context, { environment: fileEnvironment })
  ]);
  try {
    const names = copies.map(({ database }) => database);
    assert.notEqual(names[0], names[1]);
    for (const database of names) assert.match(database, new RegExp(`^${name}_[a-z]$`, "u"));
    for (const { knex: db } of copies) {
      assert.deepEqual(await db("books").pluck("title"), ["Written by the migration"]);
      assert.deepEqual(await db("knex_migrations").pluck("name"), ["20200101000000_books.cjs"]);
    }
    await copies[0].knex("books").insert({ title: "Only in the first copy" });
    assert.deepEqual(await copies[1].knex("books").pluck("title"), ["Written by the migration"]);
    for (const database of [name, file]) assert.deepEqual(await titles(database), ["Written by the migration"], database);
  } finally {
    await scratch.run();
  }
  const { rows } = await admin.raw("SELECT datname FROM pg_database WHERE datname = ANY(?)", [copies.map(({ database }) => database)]);
  assert.deepEqual(rows, []);
});

test("on PostgreSQL claimTestDatabaseCopy() outside a jskit test --databases run fails, naming the command", { skip: SKIP }, async () => {
  const scratch = teardown();
  await assert.rejects(claimTestDatabaseCopy(scratch.context, { environment: { ...process.env, JSKIT_TEST_DATABASE_SETTINGS: "" } }),
    /claimTestDatabaseCopy\(\) copies the snapshot of a `jskit test --databases` run/u);
});
