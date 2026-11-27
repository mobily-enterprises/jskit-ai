import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import knex from "knex";
import { createKnexMigrationConfig } from "@jskit-ai/database-runtime/server/knexMigrationConfig";
import {
  RUN_SETTINGS_FILE,
  claimTestDatabaseCopy,
  resetTestDatabase,
  testDatabaseRun
} from "@jskit-ai/database-runtime/server/testDatabases";

// A file of a `jskit test --databases` run that needs more than its own TEST_DB_NAME copy (two tenants, a second
// server) claims more databases holding the run's snapshot, each its own, dropped in the test's teardown.
const SKIP = !process.env.TEST_DB_NAME || !process.env.DB_HOST;
const BOOKS = `exports.up = async (knex) => {
  await knex.schema.createTable("books", (table) => { table.increments("id"); table.string("title"); });
  await knex("books").insert({ title: "Written by the migration" });
};
exports.down = () => {};
`;

/**
 * A run of `jskit test --databases` for an application in a directory of its own, whose TEST_DB_NAME is named after
 * `suffix`, and the environment one of its files gets; the run ends after the test, and the directory goes with it.
 * @param {import("node:test").TestContext} context
 * @param {string} suffix
 */
async function runFile(context, suffix) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), `jskit-test-database-copy-${suffix}-`));
  const name = `${process.env.TEST_DB_NAME}_${suffix}`;
  const server = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD };
  const admin = knex({ client: "mysql2", connection: server, pool: { min: 0, max: 1 } });
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_books.cjs"), BOOKS);
  const environment = { ...process.env, DB_NAME: `${name}_application`, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment, appRoot });
  const run = await testDatabaseRun({ knexConfig, environment, count: 2, appRoot });
  context.after(async () => {
    try {
      await run.cleanup();
      for (const database of [name, `${name}_0`]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    } finally {
      await admin.destroy();
      await rm(appRoot, { recursive: true, force: true });
    }
  });
  // What the run's preload gives the file holding the numbered copy: it as DB_NAME and TEST_DB_NAME, the run's
  // designated database, and the run's settings.
  const file = `${name}_1`;
  const fileEnvironment = { ...environment, DB_NAME: file, TEST_DB_NAME: file, JSKIT_DESIGNATED_TEST_DB_NAME: name,
    JSKIT_TEST_DATABASE_SETTINGS: path.join(run.env.JSKIT_TEST_DATABASES, RUN_SETTINGS_FILE) };
  return { name, file, admin, environment, fileEnvironment };
}

/** A test context whose teardown the test runs itself, to see what it drops. */
function teardown() {
  const cleanups = [];
  const run = async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
  };
  return { context: { after: (cleanup) => cleanups.push(cleanup) }, run };
}

/** Which of `names` are databases on the server. */
const existing = (admin, names) => admin("information_schema.SCHEMATA").whereIn("SCHEMA_NAME", names).pluck("SCHEMA_NAME");

test("claimTestDatabaseCopy() gives a file two more databases holding the run's snapshot, each its own, dropped in the test's teardown", {
  skip: SKIP
}, async (context) => {
  const { name, file, admin, fileEnvironment } = await runFile(context, "copy1");
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
    for (const database of [name, file]) {
      assert.deepEqual(await admin(`${database}.books`).pluck("title"), ["Written by the migration"], database);
    }
  } finally {
    await scratch.run();
  }
  assert.deepEqual(await existing(admin, copies.map(({ database }) => database)), []);
  for (const { database } of copies) {
    const [[{ free }]] = await admin.raw("SELECT IS_FREE_LOCK(?) AS free", [database]);
    assert.equal(Number(free), 1, database);
  }
});

test("claimTestDatabaseCopy() outside a jskit test --databases run fails, naming the command", { skip: SKIP }, async () => {
  const scratch = teardown();
  await assert.rejects(claimTestDatabaseCopy(scratch.context, { environment: { ...process.env, JSKIT_TEST_DATABASE_SETTINGS: "" } }),
    /claimTestDatabaseCopy\(\) copies the snapshot of a `jskit test --databases` run/u);
});

test("resetTestDatabase() restores a file's own copy to the run's snapshot mid-file, replacing only the tables written since", {
  skip: SKIP
}, async (context) => {
  const { file, admin, fileEnvironment } = await runFile(context, "reset1");
  // An earlier test of the file wrote a book and left a table of its own; its server still holds a connection.
  const db = knex({ client: "mysql2", connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: file }, pool: { min: 1, max: 1 } });
  try {
    await db("books").insert({ title: "Written by an earlier test" });
    await db.schema.createTable("scratch", (table) => table.increments("id"));
    assert.deepEqual(await resetTestDatabase({ environment: fileEnvironment }), ["books", "scratch"]);
    assert.deepEqual(await db("books").pluck("title"), ["Written by the migration"]);
    assert.equal(await db.schema.hasTable("scratch"), false);
    // Nothing written since: nothing replaced.
    assert.deepEqual(await resetTestDatabase({ environment: fileEnvironment }), []);
    assert.deepEqual(await admin(`${file}.knex_migrations`).pluck("name"), ["20200101000000_books.cjs"]);
  } finally {
    await db.destroy();
  }
  await assert.rejects(resetTestDatabase({ environment: { ...process.env, JSKIT_TEST_DATABASE_SETTINGS: "" } }),
    /resetTestDatabase\(\) restores the snapshot of a `jskit test --databases` run/u);
});
