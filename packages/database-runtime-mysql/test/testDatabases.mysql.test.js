import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Fastify from "fastify";
import knex from "knex";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { DatabaseProvider } from "@jskit-ai/database-runtime/server/providers/DatabaseProvider";
import { createKnexMigrationConfig } from "@jskit-ai/database-runtime/server/knexMigrationConfig";
import {
  RUN_SETTINGS_FILE,
  countQueries,
  countRuntimeQueries,
  matchesSnapshot,
  prepareTestDatabases,
  restoreTestDatabase,
  testDatabaseRun
} from "@jskit-ai/database-runtime/server/testDatabases";
import { MysqlDatabaseDriverProvider } from "../src/server/providers/MysqlDatabaseDriverProvider.js";

const BOOKS = `exports.up = async (knex) => {
  await knex.schema.createTable("books", (table) => { table.increments("id"); table.string("title"); table.date("published_on"); });
  await knex.schema.createTable("reviews", (table) => { table.increments("id"); table.integer("book_id").unsigned().references("books.id"); });
  await knex("books").insert({ id: 1, title: "Written by the migration", published_on: "2020-01-02" });
};
exports.down = () => {};
`;
const execFileAsync = promisify(execFile);
const SHELVES = "exports.up = (knex) => knex.schema.createTable(\"shelves\", (table) => table.increments(\"id\"));\nexports.down = () => {};\n";

test("each test database is restored from one snapshot, rebuilt only when a migration changes", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-mysql-"));
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_books.cjs"), BOOKS);
  const name = `${process.env.TEST_DB_NAME}_copies`;
  // The application's database is one this test never creates; only `name` and its copies are touched.
  const environment = { ...process.env, DB_NAME: `${process.env.TEST_DB_NAME}_application`, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment, appRoot });
  const server = { ...knexConfig.connection, database: undefined };
  const admin = knex({ client: "mysql2", connection: server });
  const names = [name, `${name}_1`, `${name}_2`];
  const on = (database) => knex({ client: "mysql2", connection: { ...server, database } });
  context.after(async () => {
    for (const database of names) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    await admin.destroy();
    await rm(appRoot, { recursive: true, force: true });
  });
  const seed = (transaction) => transaction("books").insert({ id: 2, title: "Seeded" });

  const first = await prepareTestDatabases({ knexConfig, environment, count: 3, seed, appRoot });
  assert.deepEqual(first.databases, names);
  assert.match(first.summary, /1 migrations replayed once for a new snapshot/u);
  for (const database of names) {
    const db = on(database);
    try {
      assert.deepEqual(await db("books").orderBy("id").select("id", "title"), [
        { id: 1, title: "Written by the migration" },
        { id: 2, title: "Seeded" }
      ], database);
      assert.deepEqual(await db("knex_migrations").pluck("name"), ["20200101000000_books.cjs"]);
      // The foreign key came with the table's definition and is enforced.
      await assert.rejects(db("reviews").insert({ book_id: 99 }), /foreign key constraint/iu);
    } finally {
      await db.destroy();
    }
  }

  const second = on(names[1]);
  try {
    await second("books").insert({ id: 3, title: "Stale" });
  } finally {
    await second.destroy();
  }
  const again = await prepareTestDatabases({ knexConfig, environment, count: 3, seed, appRoot });
  assert.match(again.summary, /stored snapshot/u);
  const restored = on(names[1]);
  try {
    assert.deepEqual(await restored("books").orderBy("id").pluck("id"), [1, 2]);
    assert.equal(await matchesSnapshot(knexConfig, names[1], again.snapshot), true);
    // A file that migrates down or drops a table leaves its database dirty, until it is restored.
    await restored.schema.dropTable("reviews");
    assert.equal(await matchesSnapshot(knexConfig, names[1], again.snapshot), false);
    await restoreTestDatabase(knexConfig, names[1], again.snapshot);
    assert.equal(await matchesSnapshot(knexConfig, names[1], again.snapshot), true);
  } finally {
    await restored.destroy();
  }
  // A file that drops its whole database leaves the next file a restored one.
  await admin.raw("DROP DATABASE ??", [names[2]]);
  assert.equal(await matchesSnapshot(knexConfig, names[2], again.snapshot), false);
  await restoreTestDatabase(knexConfig, names[2], again.snapshot);
  assert.equal(await matchesSnapshot(knexConfig, names[2], again.snapshot), true);

  await writeFile(path.join(appRoot, "migrations", "20200102000000_shelves.cjs"), SHELVES);
  const changed = await prepareTestDatabases({ knexConfig, environment, count: 2, appRoot });
  assert.notEqual(changed.snapshot.key, again.snapshot.key);
  assert.match(changed.summary, /2 migrations replayed once for a new snapshot/u);
  assert.deepEqual(changed.snapshot.tables, ["books", "knex_migrations", "knex_migrations_lock", "reviews", "shelves"]);

  // jskit test --databases: one database per file at once, handed to each file's process by the preload. The
  // environment names the run's directory only; the password is in a file only this user may read.
  const run = await testDatabaseRun({ knexConfig, environment, count: 2, appRoot });
  try {
    assert.equal(run.concurrency, 2);
    assert.match(run.preload, /testDatabaseFile\.js$/u);
    assert.deepEqual(Object.keys(run.env), ["JSKIT_TEST_DATABASES"]);
    const settingsFile = path.join(run.env.JSKIT_TEST_DATABASES, RUN_SETTINGS_FILE);
    assert.equal((await stat(settingsFile)).mode & 0o777, 0o600);
    assert.equal((await stat(run.env.JSKIT_TEST_DATABASES)).mode & 0o077, 0);
    const settings = JSON.parse(await readFile(settingsFile, "utf8"));
    assert.deepEqual(settings.databases, [name, `${name}_1`]);
    assert.deepEqual(Object.keys(settings.knexConfig).sort(), ["client", "connection", "migrations"]);
    if (knexConfig.connection.password) assert.equal(JSON.stringify(run.env).includes(knexConfig.connection.password), false);
  } finally {
    run.cleanup();
  }

  // The application's own database was never created or touched.
  const [[application]] = await admin.raw("SELECT COUNT(*) AS count FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
    [environment.DB_NAME]);
  assert.equal(Number(application.count), 0);
});

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const JSKIT_CLI = path.join(REPO_ROOT, "tooling", "jskit-catalog", "scripts", "jskit.mjs");
const FIXTURE_KNEXFILE = `import { createKnexMigrationConfig } from "@jskit-ai/database-runtime/server/knexMigrationConfig";
try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
export default createKnexMigrationConfig({ client: "mysql2", environment: process.env });
`;
// Each file waits until the other has started, so both hold a database at once, then records what it was given (the
// password as a digest).
const FIXTURE_TEST = (name, other) => `import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import test from "node:test";
test("${name}", async () => {
  writeFileSync("started-${name}", "");
  const deadline = Date.now() + 30000;
  while (!existsSync("started-${other}") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  writeFileSync("seen-${name}.json", JSON.stringify({
    db: process.env.DB_NAME, test: process.env.TEST_DB_NAME, settings: process.env.JSKIT_TEST_DATABASES ?? null,
    dotenv: process.env.FIXTURE_ONLY_IN_DOTENV ?? null, other: existsSync("started-${other}"),
    connection: { host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
      password: createHash("sha256").update(process.env.DB_PASSWORD ?? "(none)").digest("hex") }
  }));
});
`;

test("jskit test --databases gives each test file running at once its own restored copy and its connection, and nothing else of the .env", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-cli-"));
  const name = `${process.env.TEST_DB_NAME}_cli`;
  const server = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD };
  const admin = knex({ client: "mysql2", connection: server });
  context.after(async () => {
    for (const database of [name, `${name}_1`]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    await admin.destroy();
    await rm(appRoot, { recursive: true, force: true });
  });
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await mkdir(path.join(appRoot, "test"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_books.cjs"), BOOKS);
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "cli-fixture", type: "module", private: true }));
  await writeFile(path.join(appRoot, "knexfile.js"), FIXTURE_KNEXFILE);
  // The knexfile loads the connection from it, which each test file gets with its database; nothing else of it.
  await writeFile(path.join(appRoot, ".env"), [
    `DB_HOST=${server.host}`, `DB_PORT=${server.port}`, `DB_USER=${server.user}`, `DB_PASSWORD=${server.password ?? ""}`,
    "FIXTURE_ONLY_IN_DOTENV=1", ""
  ].join("\n"), { mode: 0o600 });
  await writeFile(path.join(appRoot, "test", "a.test.js"), FIXTURE_TEST("a", "b"));
  await writeFile(path.join(appRoot, "test", "b.test.js"), FIXTURE_TEST("b", "a"));
  // The fixture's own node_modules (its snapshot cache goes there), resolving JSKIT's packages from this repository.
  await mkdir(path.join(appRoot, "node_modules"));
  await symlink(path.join(REPO_ROOT, "node_modules", "@jskit-ai"), path.join(appRoot, "node_modules", "@jskit-ai"), "dir");

  const env = { ...process.env, V64_TEST_CONCURRENCY: "2", DB_NAME: `${process.env.TEST_DB_NAME}_cli_application`,
    TEST_DB_NAME: name, DATABASE_URL: "" };
  for (const name of ["NODE_TEST_CONTEXT", "FIXTURE_ONLY_IN_DOTENV", "DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD"]) {
    delete env[name];
  }
  const { stderr } = await execFileAsync(process.execPath, [JSKIT_CLI, "test", "--databases"], { cwd: appRoot, env });
  assert.match(stderr, /jskit test: 2 test database\(s\) from .+_cli ready in \d+ms: 1 migrations replayed once/u);
  assert.match(stderr, /jskit test: 2 test file\(s\) at a time \(test databases\)\./u);
  const seen = await Promise.all(["a", "b"].map(async (file) => JSON.parse(await readFile(path.join(appRoot, `seen-${file}.json`), "utf8"))));
  assert.deepEqual(seen.map(({ db }) => db).sort(), [name, `${name}_1`]);
  const connection = { host: server.host, port: String(server.port), user: server.user,
    password: createHash("sha256").update(server.password ?? "").digest("hex") };
  for (const { db, test: testDatabase, settings, dotenv, other, connection: given } of seen) {
    assert.equal(testDatabase, db);
    assert.equal(settings, null);
    assert.equal(dotenv, null);
    assert.equal(other, true);
    assert.deepEqual(given, connection);
  }
  const copy = knex({ client: "mysql2", connection: { ...server, database: `${name}_1` } });
  try {
    assert.deepEqual(await copy("books").pluck("title"), ["Written by the migration"]);
  } finally {
    await copy.destroy();
  }

  // A focused run of one file prepares one database, from the stored snapshot.
  const focused = await execFileAsync(process.execPath, [JSKIT_CLI, "test", "--databases", "test/a.test.js"], { cwd: appRoot, env });
  assert.match(focused.stderr, /jskit test: 1 test database\(s\) from .+_cli ready in \d+ms: stored snapshot/u);
});

test("countQueries() counts a MySQL or MariaDB path's statements, its transactions' included", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async (context) => {
  const database = `${process.env.TEST_DB_NAME}_queries`;
  const environment = { ...process.env, DB_NAME: database, DATABASE_URL: "" };
  const { connection } = createKnexMigrationConfig({ client: "mysql2", environment, appRoot: os.tmpdir() });
  const server = knex({ client: "mysql2", connection: { ...connection, database: undefined } });
  await server.raw("CREATE DATABASE IF NOT EXISTS ??", [database]);
  const db = knex({ client: "mysql2", connection });
  context.after(async () => {
    await db.destroy();
    await server.raw("DROP DATABASE IF EXISTS ??", [database]);
    await server.destroy();
  });
  await db.schema.createTable("books", (table) => { table.increments("id"); table.string("title"); });
  await db("books").insert(Array.from({ length: 30 }, (_, index) => ({ title: `Book ${index + 1}` })));
  const ids = await db("books").orderBy("id").pluck("id");

  const perBook = await countQueries(db, () => Promise.all(ids.map((id) => db("books").where({ id }).first("title"))));
  assert.deepEqual([perBook.count, perBook.queries[29]], [30, "select `title` from `books` where `id` = ? limit ?"]);
  const together = await countQueries(db, () => db("books").whereIn("id", ids).pluck("title"));
  assert.deepEqual([together.count, together.result.length], [1, 30]);
  const transaction = await countQueries(db, () => db.transaction((trx) => trx("books").count({ books: "*" })));
  assert.deepEqual(transaction.queries, ["BEGIN;", "select count(*) as `books` from `books`", "COMMIT;"]);
});

test("countRuntimeQueries() sees a route of a server booted in the test read per row, at 10 rows and at 200", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async (context) => {
  const database = `${process.env.TEST_DB_NAME}_routes`;
  const environment = { ...process.env, DB_NAME: database, DATABASE_URL: "" };
  const { connection } = createKnexMigrationConfig({ client: "mysql2", environment, appRoot: os.tmpdir() });
  const server = knex({ client: "mysql2", connection: { ...connection, database: undefined } });
  await server.raw("CREATE DATABASE IF NOT EXISTS ??", [database]);
  const testKnex = knex({ client: "mysql2", connection });
  const app = Fastify({ logger: false });
  const routes = defineProvider({
    id: "test.books.routes",
    requires: { database: "runtime.database" },
    setup({ database: { knex: db } }) {
      // The list's books, read one by one, and the same list in one read.
      app.get("/books", async (request) => {
        const ids = await db("books").orderBy("id").limit(Number(request.query.limit)).pluck("id");
        const books = [];
        for (const id of ids) books.push(await db("books").where({ id }).first("id", "title"));
        return books;
      });
      app.get("/books/batched", async (request) => db("books").orderBy("id").limit(Number(request.query.limit)).select("id", "title"));
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.env": environment },
    providers: [MysqlDatabaseDriverProvider, DatabaseProvider, routes]
  });
  context.after(async () => {
    await app.close();
    await runtime.shutdown();
    await testKnex.destroy();
    await server.raw("DROP DATABASE IF EXISTS ??", [database]);
    await server.destroy();
  });
  await testKnex.schema.createTable("books", (table) => { table.increments("id"); table.string("title"); });
  await testKnex("books").insert(Array.from({ length: 200 }, (_, index) => ({ title: `Book ${index + 1}` })));
  await runtime.start();

  const listed = async (url) => {
    const { result: response, count, queries } = await countRuntimeQueries(async () => {
      // The test's own Knex is not the runtime's, so its statements do not count.
      await testKnex("books").count({ books: "*" });
      return app.inject(url);
    });
    assert.equal(response.statusCode, 200, url);
    return { count, books: response.json().length, last: queries.at(-1) };
  };
  const perBook = "select `id`, `title` from `books` where `id` = ? limit ?";
  assert.deepEqual(await listed("/books?limit=10"), { count: 11, books: 10, last: perBook });
  assert.deepEqual(await listed("/books?limit=200"), { count: 201, books: 200, last: perBook });
  const batched = "select `id`, `title` from `books` order by `id` asc limit ?";
  assert.deepEqual(await listed("/books/batched?limit=10"), { count: 1, books: 10, last: batched });
  assert.deepEqual(await listed("/books/batched?limit=200"), { count: 1, books: 200, last: batched });
});
