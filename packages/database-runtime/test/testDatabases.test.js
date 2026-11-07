import assert from "node:assert/strict";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createKnexMigrationConfig } from "../src/server/knexMigrationConfig.js";
import {
  requireDisposableDatabase,
  testDatabaseNames,
  testDatabaseRun,
  testDatabaseSnapshotKey
} from "../src/server/testDatabases.js";

const connectionEnvironment = Object.freeze({
  DB_HOST: "127.0.0.1",
  DB_NAME: "catalogue",
  DB_USER: "catalogue_user",
  DB_PASSWORD: "secret"
});
const MIGRATION = "exports.up = (knex) => knex.schema.createTable(\"books\", (table) => table.increments());\nexports.down = () => {};\n";

test("a run's test databases are the designated one, then its numbered copies", () => {
  assert.deepEqual(testDatabaseNames("catalogue_test", 1), ["catalogue_test"]);
  assert.deepEqual(testDatabaseNames("catalogue_test", 3), ["catalogue_test", "catalogue_test_1", "catalogue_test_2"]);
});

test("a test database and its copies are never the application's database, production or the other test database", () => {
  const environment = { ...connectionEnvironment, TEST_DB_NAME: "catalogue_test", BROWSER_TEST_DB_NAME: "catalogue_browser" };
  assert.equal(requireDisposableDatabase(environment, "TEST_DB_NAME", 4), "catalogue_test");
  assert.equal(requireDisposableDatabase(environment, "BROWSER_TEST_DB_NAME", 4), "catalogue_browser");
  for (const [overrides, variable, count, message] of [
    [{ TEST_DB_NAME: "" }, "TEST_DB_NAME", 1, /must name a disposable test database/u],
    [{ TEST_DB_NAME: "catalogue-test" }, "TEST_DB_NAME", 1, /must name a disposable test database/u],
    [{ TEST_DB_NAME: "Catalogue" }, "TEST_DB_NAME", 1, /DB_NAME, DATABASE_URL and PROD_DB_NAME \(catalogue\)/u],
    [{ DB_NAME: "", DATABASE_URL: "mysql://u:p@db/catalogue_test" }, "TEST_DB_NAME", 1, /DATABASE_URL/u],
    [{ PROD_DB_NAME: "catalogue_test_2" }, "TEST_DB_NAME", 3, /PROD_DB_NAME \(catalogue_test_2\)/u],
    [{ BROWSER_TEST_DB_NAME: "catalogue_test" }, "TEST_DB_NAME", 1, /the other test database/u],
    [{ BROWSER_TEST_DB_NAME: "catalogue_test_1" }, "TEST_DB_NAME", 2, /the other test database/u],
    [{ TEST_DB_NAME: "catalogue_browser_2" }, "BROWSER_TEST_DB_NAME", 1, /the other test database/u],
    [{ NODE_ENV: "production" }, "TEST_DB_NAME", 1, /NODE_ENV=production/u]
  ]) {
    assert.throws(() => requireDisposableDatabase({ ...environment, ...overrides }, variable, count), message,
      JSON.stringify(overrides));
  }
  // The database the Knex configuration connects to, whatever the environment says.
  assert.throws(() => requireDisposableDatabase({ ...environment, DB_NAME: "" }, "TEST_DB_NAME", 2, { connected: "Catalogue_Test_1" }),
    /PROD_DB_NAME \(catalogue_test_1\)/u);
});

test("the snapshot key changes when a migration changes, is added or is renamed, and only then", async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_books.cjs"), MIGRATION);
  const knexConfig = createKnexMigrationConfig({ client: "pg", environment: connectionEnvironment, appRoot });

  const first = await testDatabaseSnapshotKey(knexConfig);
  assert.match(first.key, /^[0-9a-f]{32}$/u);
  assert.deepEqual(first.migrations, ["20200101000000_books.cjs"]);
  assert.deepEqual(await testDatabaseSnapshotKey(knexConfig), first);

  const keys = new Set([first.key]);
  await writeFile(path.join(appRoot, "migrations", "20200101000000_books.cjs"), MIGRATION.replace("increments()", "increments(\"book_id\")"));
  keys.add((await testDatabaseSnapshotKey(knexConfig)).key);
  await writeFile(path.join(appRoot, "migrations", "constraints", "20200102000000_books_index.cjs"), MIGRATION);
  const added = await testDatabaseSnapshotKey(knexConfig);
  keys.add(added.key);
  assert.deepEqual(added.migrations, ["20200101000000_books.cjs", "20200102000000_books_index.cjs"]);
  await rename(
    path.join(appRoot, "migrations", "20200101000000_books.cjs"),
    path.join(appRoot, "migrations", "20200101000001_books.cjs")
  );
  keys.add((await testDatabaseSnapshotKey(knexConfig)).key);
  keys.add((await testDatabaseSnapshotKey({ ...knexConfig, client: "mysql2" })).key);
  assert.equal(keys.size, 5);

  // Installing other packages can change what their migrations' helpers build.
  const before = await testDatabaseSnapshotKey(knexConfig, { appRoot });
  await writeFile(path.join(appRoot, "package-lock.json"), "{\"lockfileVersion\":3}\n");
  const locked = await testDatabaseSnapshotKey(knexConfig, { appRoot });
  assert.notEqual(locked.key, before.key);
  assert.deepEqual(await testDatabaseSnapshotKey(knexConfig, { appRoot }), locked);
});

test("with no usable test database, a run's test files run one at a time on the connected database", async () => {
  const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment: connectionEnvironment, appRoot: "/srv/catalogue" });
  for (const [environment, reason] of [
    [connectionEnvironment, /TEST_DB_NAME is not set/u],
    [{ ...connectionEnvironment, TEST_DB_NAME: "CATALOGUE" }, /the connected database is TEST_DB_NAME \(CATALOGUE\)/u]
  ]) {
    const run = await testDatabaseRun({ knexConfig, environment, count: 4 });
    assert.equal(run.concurrency, 1);
    assert.deepEqual(run.env, {});
    assert.equal(run.preload, "");
    assert.match(run.summary, /^test files run one at a time on the connected database: /u);
    assert.match(run.summary, reason);
  }
});

test("a test database copy named like a protected database fails the run instead of running on it", async () => {
  const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment: connectionEnvironment, appRoot: "/srv/catalogue" });
  const environment = { ...connectionEnvironment, TEST_DB_NAME: "catalogue_test", PROD_DB_NAME: "catalogue_test_1" };
  await assert.rejects(testDatabaseRun({ knexConfig, environment, count: 4 }), /PROD_DB_NAME \(catalogue_test_1\)/u);
});
