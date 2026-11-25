import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import knexFactory from "knex";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { DatabaseProvider } from "../src/server/providers/DatabaseProvider.js";
import { createKnexMigrationConfig } from "../src/server/knexMigrationConfig.js";
import {
  countQueries,
  countRuntimeQueries,
  matchesSnapshot,
  prepareTestDatabases,
  restoreTestDatabase,
  testDatabaseRun
} from "../src/server/testDatabases.js";

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

test("a jskit test --databases run on PostgreSQL drops the numbered copies it made when it ends, and keeps TEST_DB_NAME and its snapshot", {
  skip: SKIP
}, async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-pg-run-"));
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_books.cjs"), BOOKS);
  const name = `${TEST_DB_NAME}_run`;
  const environment = { ...process.env, DB_CLIENT: "pg", DB_NAME: TEST_DB_NAME, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "pg", environment, appRoot });
  const on = (database) => knexFactory({ client: "pg", connection: { ...knexConfig.connection, database } });
  // `_7` is numbered like a copy, but a run of three files makes only `_1` and `_2`.
  const candidates = [name, `${name}_1`, `${name}_2`, `${name}_7`, `${name}_snapshot`];
  const admin = on(TEST_DB_NAME);
  context.after(async () => {
    try {
      for (const database of candidates) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    } finally {
      await admin.destroy();
    }
    await rm(appRoot, { recursive: true, force: true });
  });
  const present = async () => (await admin("pg_database").whereIn("datname", candidates).pluck("datname")).sort();
  for (const database of candidates) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
  await admin.raw("CREATE DATABASE ??", [`${name}_7`]);

  const run = await testDatabaseRun({ knexConfig, environment, count: 3, appRoot });
  assert.equal(run.concurrency, 3);
  assert.deepEqual(await present(), candidates);
  assert.equal(await run.cleanup(), "dropped the run's 2 numbered test database(s)");
  assert.equal(existsSync(run.env.JSKIT_TEST_DATABASES), false);
  assert.deepEqual(await present(), [name, `${name}_7`, `${name}_snapshot`]);

  // The next run in the same tree restores the stored snapshot. A copy a session is still connected to stays.
  const next = await testDatabaseRun({ knexConfig, environment, count: 3, appRoot });
  assert.match(next.summary, /stored snapshot/u);
  const holding = on(`${name}_2`);
  try {
    await holding.raw("SELECT 1");
    assert.equal(await next.cleanup(),
      `dropped 1 of the run's 2 numbered test database(s); kept ${name}_2, which a session is connected to`);
  } finally {
    await holding.destroy();
  }
  assert.deepEqual(await present(), [name, `${name}_2`, `${name}_7`, `${name}_snapshot`]);

  // A run whose check fails before any test file starts drops its copies as it fails.
  const checkDatabase = async () => {
    throw new Error("a declared foreign key is missing");
  };
  await assert.rejects(testDatabaseRun({ knexConfig, environment, count: 3, appRoot, checkDatabase }), /declared foreign key is missing/u);
  assert.deepEqual(await present(), [name, `${name}_7`, `${name}_snapshot`]);
});

test("countQueries() counts a PostgreSQL path's statements, its transactions' included", { skip: SKIP }, async (context) => {
  const { connection } = createKnexMigrationConfig({ client: "pg", environment: { ...process.env, DB_CLIENT: "pg" }, appRoot: os.tmpdir() });
  const db = knexFactory({ client: "pg", connection });
  const table = "query_count_books";
  context.after(async () => {
    await db.schema.dropTableIfExists(table);
    await db.destroy();
  });
  await db.schema.dropTableIfExists(table);
  await db.schema.createTable(table, (columns) => { columns.increments("id"); columns.string("title"); });
  const ids = (await db(table).insert(Array.from({ length: 30 }, (_, index) => ({ title: `Book ${index + 1}` })), ["id"])).map((row) => row.id);

  const each = await countQueries(db, async () => {
    for (const id of ids) await db(table).where({ id }).first("title");
  });
  assert.equal(each.count, 30);
  assert.equal(each.queries[0], `select "title" from "${table}" where "id" = $1 limit $2`);
  assert.equal((await countQueries(db, () => db(table).whereIn("id", ids).pluck("title"))).count, 1);
  const inTransaction = await countQueries(db, () => db.transaction((trx) => trx(table).count({ books: "*" })));
  assert.deepEqual(inTransaction.queries, ["BEGIN;", `select count(*) as "books" from "${table}"`, "COMMIT;"]);
});

test("countRuntimeQueries() counts a PostgreSQL route's reads through the runtime the test booted", { skip: SKIP }, async (context) => {
  const table = "route_count_books";
  const environment = { ...process.env, DB_CLIENT: "pg" };
  const { connection } = createKnexMigrationConfig({ client: "pg", environment, appRoot: os.tmpdir() });
  const own = knexFactory({ client: "pg", connection });
  const app = Fastify({ logger: false });
  const driver = defineProvider({
    id: "test.database.driver.pg",
    provides: { driver: "runtime.database.driver" },
    setup: () => ({ driver: Object.freeze({ DIALECT_ID: "pg" }) })
  });
  const route = defineProvider({
    id: "test.route",
    requires: { database: "runtime.database" },
    setup({ database }) {
      app.get("/titles/:count", async (request) => {
        const rows = await database.knex(table).select("id").orderBy("id").limit(Number(request.params.count));
        return Promise.all(rows.map(({ id }) => database.knex(table).where({ id }).first("title")));
      });
      return {};
    }
  });
  const runtime = createCapabilityRuntime({ inputs: { "runtime.env": environment }, providers: [driver, DatabaseProvider, route] });
  context.after(async () => {
    await app.close();
    await runtime.shutdown();
    await own.schema.dropTableIfExists(table);
    await own.destroy();
  });
  await own.schema.dropTableIfExists(table);
  await own.schema.createTable(table, (columns) => { columns.increments("id"); columns.string("title"); });
  await own(table).insert(Array.from({ length: 200 }, (_, index) => ({ title: `Title ${index + 1}` })));
  await runtime.start();

  const counts = [];
  for (const count of [10, 200]) {
    const { result, count: statements } = await countRuntimeQueries(() => app.inject(`/titles/${count}`));
    assert.equal(result.json().length, count);
    counts.push(statements);
  }
  // A read per title: the statements follow the rows.
  assert.deepEqual(counts, [11, 201]);
});

test("a PostgreSQL snapshot built by the application's own schema build carries its baseline and its ledger", {
  skip: SKIP
}, async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-pg-baseline-"));
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_shelf_colour.cjs"),
    "exports.up = (knex) => knex.schema.alterTable(\"shelves\", (table) => table.string(\"colour\"));\nexports.down = () => {};\n");
  await writeFile(path.join(appRoot, "baseline.sql"), "CREATE TABLE shelves (id integer PRIMARY KEY, label text)");
  const name = `${TEST_DB_NAME}_baseline`;
  const environment = { ...process.env, DB_CLIENT: "pg", DB_NAME: TEST_DB_NAME, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "pg", environment, appRoot });
  context.after(async () => {
    const admin = knexFactory({ client: "pg", connection: knexConfig.connection });
    try {
      for (const database of [name, `${name}_snapshot`]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    } finally {
      await admin.destroy();
    }
    await rm(appRoot, { recursive: true, force: true });
  });
  const schema = {
    files: ["baseline.sql"],
    async build(db) {
      await db.raw(await readFile(path.join(appRoot, "baseline.sql"), "utf8"));
      await db("shelves").insert({ id: 1, label: "Reference" });
      await db.migrate.latest();
    }
  };

  const prepared = await prepareTestDatabases({ knexConfig, environment, count: 1, schema, appRoot });
  assert.match(prepared.summary, /schema built once for a new snapshot/u);
  assert.deepEqual(prepared.snapshot.migrations, ["20200101000000_shelf_colour.cjs"]);
  const copy = knexFactory({ client: "pg", connection: { ...knexConfig.connection, database: name } });
  try {
    assert.deepEqual(await copy("shelves").select("id", "label", "colour"), [{ id: 1, label: "Reference", colour: null }]);
  } finally {
    await copy.destroy();
  }
  assert.equal(await matchesSnapshot(knexConfig, name, prepared.snapshot), true);
});
