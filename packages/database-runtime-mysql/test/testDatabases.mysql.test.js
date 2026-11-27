import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
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
  createPackageTestKnex,
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

test("each test database is copied on the server from one snapshot database, TEST_DB_NAME_0, which npm ci keeps and a changed migration rebuilds", {
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
    for (const database of [...names, `${name}_0`]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    await admin.destroy();
    await rm(appRoot, { recursive: true, force: true });
  });
  const seed = (transaction) => transaction("books").insert({ id: 2, title: "Seeded" });

  const first = await prepareTestDatabases({ knexConfig, environment, count: 3, seed, appRoot });
  assert.deepEqual(first.databases, names);
  assert.match(first.summary, /1 migrations replayed once for a new snapshot/u);
  // The snapshot is a database on the server holding what the migrations built, the seed aside; nothing is stored in
  // the application's tree, so npm ci, which empties node_modules, leaves it, and every copy is made on the server.
  assert.equal(first.snapshot.database, `${name}_0`);
  const snapshotDatabase = on(`${name}_0`);
  try {
    assert.deepEqual(await snapshotDatabase("books").orderBy("id").pluck("title"), ["Written by the migration"]);
  } finally {
    await snapshotDatabase.destroy();
  }
  await assert.rejects(stat(path.join(appRoot, "node_modules")), { code: "ENOENT" });
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
  assert.equal(again.snapshot.database, `${name}_0`);
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
  assert.equal(changed.snapshot.database, `${name}_0`);
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
    await run.cleanup();
  }

  // The application's own database was never created or touched.
  const [[application]] = await admin.raw("SELECT COUNT(*) AS count FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
    [environment.DB_NAME]);
  assert.equal(Number(application.count), 0);
});

test("a restore replaces only the tables that differ from the snapshot: rows, a moved counter, a definition, a trigger, a table missing or added", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-mysql-partial-"));
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_books.cjs"), BOOKS);
  const name = `${process.env.TEST_DB_NAME}_partial`;
  const environment = { ...process.env, DB_NAME: `${process.env.TEST_DB_NAME}_application`, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment, appRoot });
  const server = { ...knexConfig.connection, database: undefined };
  const admin = knex({ client: "mysql2", connection: server });
  const db = knex({ client: "mysql2", connection: { ...server, database: name } });
  context.after(async () => {
    await db.destroy();
    await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
    await admin.destroy();
    await rm(appRoot, { recursive: true, force: true });
  });
  const { snapshot } = await prepareTestDatabases({ knexConfig, environment, appRoot });
  const restore = () => restoreTestDatabase(knexConfig, name, snapshot);

  // A file that wrote nothing leaves nothing to replace; one that wrote a table, that table alone.
  assert.deepEqual(await restore(), []);
  await db("reviews").insert({ book_id: 1 });
  assert.deepEqual(await restore(), ["reviews"]);
  assert.deepEqual(await db("reviews").pluck("id"), []);
  // Only the counter moved: a row written and deleted, or a write rolled back. The next row takes the snapshot's id.
  await db("reviews").insert({ book_id: 1 });
  await db("reviews").del();
  assert.deepEqual(await restore(), ["reviews"]);
  await assert.rejects(db.transaction(async (transaction) => {
    await transaction("reviews").insert({ book_id: 1 });
    throw new Error("rolled back");
  }), /rolled back/u);
  assert.deepEqual(await restore(), ["reviews"]);
  assert.deepEqual(await db("reviews").insert({ book_id: 1 }), [1]);
  assert.deepEqual(await restore(), ["reviews"]);
  // A row of the snapshot's changed in place, the count unchanged; the restored books still guard reviews' key.
  await db("books").where({ id: 1 }).update({ title: "Changed" });
  assert.deepEqual(await restore(), ["books"]);
  assert.deepEqual(await db("books").pluck("title"), ["Written by the migration"]);
  await assert.rejects(db("reviews").insert({ book_id: 99 }), /foreign key constraint/iu);
  // A definition changed with the migrations unchanged, a trigger on a table whose rows are the snapshot's, a table
  // of the file's own and a ledger row deleted; then a table dropped.
  await db.schema.alterTable("books", (table) => table.string("note"));
  await db.raw("CREATE TRIGGER reviews_kept BEFORE INSERT ON reviews FOR EACH ROW SET NEW.book_id = NEW.book_id");
  await db.schema.createTable("scratch", (table) => table.increments("id"));
  await db("knex_migrations").del();
  assert.deepEqual(await restore(), ["books", "knex_migrations", "reviews", "scratch"]);
  assert.equal(await db.schema.hasColumn("books", "note"), false);
  assert.deepEqual((await db.raw("SHOW TRIGGERS"))[0], []);
  assert.equal(await db.schema.hasTable("scratch"), false);
  assert.deepEqual(await db("knex_migrations").pluck("name"), ["20200101000000_books.cjs"]);
  await db.schema.dropTable("reviews");
  assert.deepEqual(await restore(), ["reviews"]);
  assert.equal(await matchesSnapshot(knexConfig, name, snapshot), true);
  assert.deepEqual(await restore(), []);
});

// Two indexed tables: parts filled by the migration, labels left empty for a seed.
const PARTS = `exports.up = async (knex) => {
  await knex.schema.createTable("parts", (table) => { table.increments("id"); table.string("code").index(); });
  await knex.schema.createTable("labels", (table) => { table.increments("id"); table.string("text").index(); });
  await knex("parts").insert(Array.from({ length: 300 }, (_, index) => ({ code: "part-" + index })));
};
exports.down = () => {};
`;

test("a copy, a restore and a seed leave the planner the statistics of the rows they wrote, not an empty table's", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-mysql-statistics-"));
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_parts.cjs"), PARTS);
  const name = `${process.env.TEST_DB_NAME}_statistics`;
  const environment = { ...process.env, DB_NAME: `${process.env.TEST_DB_NAME}_application`, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment, appRoot });
  const server = { ...knexConfig.connection, database: undefined };
  const admin = knex({ client: "mysql2", connection: server });
  context.after(async () => {
    for (const database of [name, `${name}_1`, `${name}_0`]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    await admin.destroy();
    await rm(appRoot, { recursive: true, force: true });
  });
  // What the planner reads of each table: its index's distinct values (CARDINALITY), which InnoDB keeps from its last
  // sample of the table, so a table created and then filled reads as empty until it is sampled again.
  const distinct = async (database) => Object.fromEntries((await admin.raw("SELECT TABLE_NAME AS name, CARDINALITY AS " +
    "cardinality FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND INDEX_NAME <> 'PRIMARY'", [database]))[0]
    .map((row) => [row.name, Number(row.cardinality)]));
  const seed = (transaction) => transaction("labels").insert(Array.from({ length: 300 }, (_, index) => ({ text: `label-${index}` })));

  const { databases, snapshot } = await prepareTestDatabases({ knexConfig, environment, count: 2, seed, appRoot });
  assert.deepEqual(databases, [name, `${name}_1`]);
  for (const database of databases) {
    const seen = await distinct(database);
    assert.ok(seen.parts >= 250 && seen.labels >= 250, `${database}: ${JSON.stringify(seen)}`);
  }
  // A restore that creates a table again and fills it from the snapshot samples it again too.
  const db = knex({ client: "mysql2", connection: { ...server, database: databases[1] } });
  try {
    await db("parts").where("id", ">", 10).del();
  } finally {
    await db.destroy();
  }
  assert.ok((await restoreTestDatabase(knexConfig, databases[1], snapshot)).includes("parts"));
  const restored = await distinct(databases[1]);
  assert.ok(restored.parts >= 250, JSON.stringify(restored));
});

test("a jskit test --databases run on MySQL or MariaDB keeps its copies for the next run, whatever its count, which copies again only the tables a file changed", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-mysql-run-"));
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_books.cjs"), BOOKS);
  const name = `${process.env.TEST_DB_NAME}_run`;
  const environment = { ...process.env, DB_NAME: `${process.env.TEST_DB_NAME}_application`, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment, appRoot });
  const server = { ...knexConfig.connection, database: undefined };
  const admin = knex({ client: "mysql2", connection: server });
  const candidates = [name, `${name}_0`, `${name}_1`, `${name}_2`];
  context.after(async () => {
    for (const database of candidates) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    await admin.destroy();
    await rm(appRoot, { recursive: true, force: true });
  });
  const present = async () => (await admin("information_schema.schemata").whereIn("schema_name", candidates).pluck("schema_name")).sort();
  for (const database of candidates) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);

  // The first run makes each database's four tables: books, reviews and the migration ledger's two.
  const run = await testDatabaseRun({ knexConfig, environment, count: 3, appRoot });
  assert.equal(run.concurrency, 3);
  assert.match(run.summary, /, restore \d+ms of 12 table\(s\)$/u);
  await run.cleanup();
  await assert.rejects(stat(run.env.JSKIT_TEST_DATABASES), { code: "ENOENT" });
  assert.deepEqual(await present(), candidates, "the copies stay for the next run");

  // A file of that run wrote a book in `_2`: the next run copies that one table again, and nothing else.
  await admin(`${name}_2.books`).insert({ title: "Written by a file" });
  const next = await testDatabaseRun({ knexConfig, environment, count: 3, appRoot });
  assert.match(next.summary, /: stored snapshot, restore \d+ms of 1 table\(s\)$/u);
  assert.deepEqual(await admin(`${name}_2.books`).pluck("title"), ["Written by the migration"]);
  await next.cleanup();

  // A focused run of one file leaves the copies the whole runs use, and so does a run whose check fails.
  const focused = await testDatabaseRun({ knexConfig, environment, count: 1, appRoot });
  assert.match(focused.summary, /, restore \d+ms of 0 table\(s\)$/u);
  await focused.cleanup();
  const checkDatabase = async () => {
    throw new Error("a declared foreign key is missing");
  };
  await assert.rejects(testDatabaseRun({ knexConfig, environment, count: 3, appRoot, checkDatabase }), /declared foreign key is missing/u);
  assert.deepEqual(await present(), candidates);
});

const SHELF_COLOUR = "exports.up = (knex) => knex.schema.alterTable(\"shelves\", (table) => table.string(\"colour\"));\n" +
  "exports.down = () => {};\n";

test("an application whose migrations start from a baseline schema builds its snapshot with its own schema build", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-baseline-"));
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_shelf_colour.cjs"), SHELF_COLOUR);
  await writeFile(path.join(appRoot, "baseline.sql"), "CREATE TABLE `shelves` (`id` INT PRIMARY KEY, `label` VARCHAR(40))");
  const name = `${process.env.TEST_DB_NAME}_baseline`;
  const environment = { ...process.env, DB_NAME: `${process.env.TEST_DB_NAME}_application`, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment, appRoot });
  const server = { ...knexConfig.connection, database: undefined };
  const admin = knex({ client: "mysql2", connection: server });
  context.after(async () => {
    for (const database of [name, `${name}_0`, `${name}_1`]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    await admin.destroy();
    await rm(appRoot, { recursive: true, force: true });
  });
  // The baseline and the reference rows every test database starts with, then the migrations.
  const schema = {
    files: ["baseline.sql"],
    async build(db) {
      await db.raw(await readFile(path.join(appRoot, "baseline.sql"), "utf8"));
      await db("shelves").insert({ id: 1, label: "Reference" });
      await db.migrate.latest();
    }
  };

  // The migrations alone cannot build this schema.
  await assert.rejects(prepareTestDatabases({ knexConfig, environment, count: 2, appRoot }), /shelves/u);
  const first = await prepareTestDatabases({ knexConfig, environment, count: 2, schema, appRoot });
  assert.match(first.summary, /schema built once for a new snapshot/u);
  assert.deepEqual(first.snapshot.migrations, ["20200101000000_shelf_colour.cjs"]);
  for (const database of first.databases) {
    const db = knex({ client: "mysql2", connection: { ...server, database } });
    try {
      assert.deepEqual(await db("shelves").select("id", "label", "colour"), [{ id: 1, label: "Reference", colour: null }]);
      assert.equal(await matchesSnapshot(knexConfig, database, first.snapshot), true, database);
    } finally {
      await db.destroy();
    }
  }
  assert.match((await prepareTestDatabases({ knexConfig, environment, count: 2, schema, appRoot })).summary, /stored snapshot/u);
  await writeFile(path.join(appRoot, "baseline.sql"), "CREATE TABLE `shelves` (`id` BIGINT PRIMARY KEY, `label` VARCHAR(40))");
  const changed = await prepareTestDatabases({ knexConfig, environment, count: 2, schema, appRoot });
  assert.notEqual(changed.snapshot.key, first.snapshot.key);
  assert.match(changed.summary, /schema built once for a new snapshot/u);
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
// password as a digest), the database a package data test of its gets with the file's own environment, which names
// the run's database client, what opening a development database through the app's knexfile settings does, and the
// database another copy of the snapshot it claims gets, with its books.
const FIXTURE_TEST = (name, other) => `import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import test from "node:test";
import { createKnexMigrationConfig } from "@jskit-ai/database-runtime/server/knexMigrationConfig";
import { claimTestDatabaseCopy, createPackageTestKnex } from "@jskit-ai/database-runtime/server/testDatabases";
test("${name}", async (t) => {
  writeFileSync("started-${name}", "");
  const deadline = Date.now() + 30000;
  while (!existsSync("started-${other}") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  const own = await createPackageTestKnex(t, { environment: process.env });
  const [[{ packageDatabase }]] = await own.raw("SELECT DATABASE() AS packageDatabase");
  const copy = await claimTestDatabaseCopy(t, { environment: process.env });
  const copied = { database: copy.database, books: await copy.knex("books").pluck("title") };
  let refused = "";
  try {
    createKnexMigrationConfig({ client: "mysql2", environment: { ...process.env, DB_NAME: "app_development" } });
  } catch (error) {
    refused = error.message;
  }
  writeFileSync("seen-${name}.json", JSON.stringify({ packageDatabase, copied, refused, client: process.env.DB_CLIENT ?? null,
    db: process.env.DB_NAME, test: process.env.TEST_DB_NAME, settings: process.env.JSKIT_TEST_DATABASES ?? null,
    dotenv: process.env.FIXTURE_ONLY_IN_DOTENV ?? null, other: existsSync("started-${other}"),
    connection: { host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
      password: createHash("sha256").update(process.env.DB_PASSWORD ?? "(none)").digest("hex") }
  }));
});
`;
// Each file records the books it found, then writes one of its own, and writes a review and deletes it: the reviews
// are the snapshot's again, their counter is not. It records the id its review took.
const FIXTURE_ROWS_TEST = (name) => `import { writeFileSync } from "node:fs";
import test from "node:test";
import knex from "knex";
test("${name}", async () => {
  const { DB_HOST: host, DB_PORT: port, DB_USER: user, DB_PASSWORD: password, DB_NAME: database } = process.env;
  const db = knex({ client: "mysql2", connection: { host, port: Number(port), user, password, database } });
  try {
    const titles = await db("books").orderBy("id").pluck("title");
    await db("books").insert({ title: "Written by ${name}" });
    const [review] = await db("reviews").insert({ book_id: 1 });
    await db("reviews").where({ id: review }).del();
    writeFileSync("seen-${name}.json", JSON.stringify({ db: database, titles, review }));
  } finally {
    await db.destroy();
  }
});
`;

/**
 * A fixture application on this test's database server, with the books migration and the given test files, and the
 * environment `jskit test` runs it with: `concurrency` files at a time, on databases named after `suffix`, which are
 * dropped after the test.
 * @param {import("node:test").TestContext} context
 * @param {string} suffix
 * @param {{ tests: Record<string, string>, concurrency: number }} options
 */
async function fixtureApplication(context, suffix, { tests, concurrency }) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), `jskit-test-databases-${suffix}-`));
  const name = `${process.env.TEST_DB_NAME}_${suffix}`;
  const server = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD };
  const admin = knex({ client: "mysql2", connection: server });
  context.after(async () => {
    for (const database of [name, `${name}_0`, `${name}_1`, `${name}_a`, `${name}_b`]) {
      await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    }
    await admin.destroy();
    await rm(appRoot, { recursive: true, force: true });
  });
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await mkdir(path.join(appRoot, "test"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_books.cjs"), BOOKS);
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: `${suffix}-fixture`, type: "module", private: true }));
  await writeFile(path.join(appRoot, "knexfile.js"), FIXTURE_KNEXFILE);
  // The knexfile loads the connection from it, which each test file gets with its database; nothing else of it.
  await writeFile(path.join(appRoot, ".env"), [
    `DB_HOST=${server.host}`, `DB_PORT=${server.port}`, `DB_USER=${server.user}`, `DB_PASSWORD=${server.password ?? ""}`,
    "FIXTURE_ONLY_IN_DOTENV=1", ""
  ].join("\n"), { mode: 0o600 });
  for (const [file, source] of Object.entries(tests)) await writeFile(path.join(appRoot, "test", file), source);
  // The fixture's own node_modules (its snapshot cache goes there), resolving JSKIT's packages and knex from this
  // repository. The whole scope is fine: the run checks a package's declared foreign keys only where its table exists,
  // and only the fixture's books migration runs here.
  await mkdir(path.join(appRoot, "node_modules"));
  await symlink(path.join(REPO_ROOT, "node_modules", "@jskit-ai"), path.join(appRoot, "node_modules", "@jskit-ai"), "dir");
  await symlink(path.join(REPO_ROOT, "node_modules", "knex"), path.join(appRoot, "node_modules", "knex"), "dir");

  const env = { ...process.env, V64_TEST_CONCURRENCY: String(concurrency), DB_NAME: `${name}_application`,
    TEST_DB_NAME: name, DATABASE_URL: "" };
  for (const variable of ["NODE_TEST_CONTEXT", "FIXTURE_ONLY_IN_DOTENV", "DB_CLIENT", "DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD"]) {
    delete env[variable];
  }
  return { appRoot, name, server, env };
}

test("jskit test --databases gives each test file running at once its own restored copy, its connection and client, and nothing else of the .env", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async (context) => {
  const { appRoot, name, server, env } = await fixtureApplication(context, "cli", {
    tests: { "a.test.js": FIXTURE_TEST("a", "b"), "b.test.js": FIXTURE_TEST("b", "a") },
    concurrency: 2
  });
  const { stderr } = await execFileAsync(process.execPath, [JSKIT_CLI, "test", "--databases"], { cwd: appRoot, env });
  assert.match(stderr, /jskit test: 2 test database\(s\) from .+_cli ready in \d+ms: 1 migrations replayed once/u);
  assert.match(stderr, /jskit test: 2 test file\(s\) at a time \(test databases\)\./u);
  assert.match(stderr, /; foreign keys: 0 declared, all in the database \([1-9]\d* JSKIT package table\(s\) the database does not have are not checked\)/u);
  const seen = await Promise.all(["a", "b"].map(async (file) => JSON.parse(await readFile(path.join(appRoot, `seen-${file}.json`), "utf8"))));
  assert.deepEqual(seen.map(({ db }) => db).sort(), [name, `${name}_1`]);
  const connection = { host: server.host, port: String(server.port), user: server.user,
    password: createHash("sha256").update(server.password ?? "").digest("hex") };
  for (const { db, test: testDatabase, settings, dotenv, other, connection: given, packageDatabase, copied, client, refused } of seen) {
    assert.equal(testDatabase, db);
    // Another copy of the snapshot, rows included, on a lettered copy of its own.
    assert.match(copied.database, new RegExp(`^${name}_[a-z]$`, "u"));
    assert.notEqual(copied.database, packageDatabase);
    assert.deepEqual(copied.books, ["Written by the migration"]);
    // A file opens only the databases the run gave it: its copy and the lettered copies its package data tests claim.
    assert.match(refused, new RegExp("^DB_NAME names app_development, which is not one of the test databases this test file " +
      `was given by \`jskit test --databases\` \\(${db}, ${name}_a and 25 more\\): a test never reaches a development or ` +
      "production database\\. ", "u"));
    // The run's knexfile fixes the client; the file gets it with its database, so its package data tests use it too.
    assert.equal(client, "mysql2");
    // A package data test claims a lettered copy of the run's designated database, not of the file's numbered copy.
    assert.match(packageDatabase, new RegExp(`^${name}_[a-z]$`, "u"));
    assert.equal(settings, null);
    assert.equal(dotenv, null);
    assert.equal(other, true);
    assert.deepEqual(given, connection);
  }
  // The run keeps TEST_DB_NAME and its copy for the next run, which restores them.
  assert.doesNotMatch(stderr, /dropped/u);
  const admin = knex({ client: "mysql2", connection: server });
  try {
    assert.deepEqual(await admin("information_schema.schemata").whereIn("schema_name", [name, `${name}_1`]).orderBy("schema_name")
      .pluck("schema_name"), [name, `${name}_1`]);
    assert.deepEqual(await admin(`${name}.books`).pluck("title"), ["Written by the migration"]);
  } finally {
    await admin.destroy();
  }

  // A focused run of one file restores one database from the stored snapshot: neither file wrote to its own, so it
  // copies no table.
  const focused = await execFileAsync(process.execPath, [JSKIT_CLI, "test", "--databases", "test/a.test.js"], { cwd: appRoot, env });
  assert.match(focused.stderr, /jskit test: 1 test database\(s\) from .+_cli ready in \d+ms: stored snapshot, restore \d+ms of 0 table\(s\)/u);
});

test("jskit test --databases gives a file that follows another on the same copy the snapshot again, rows and counters included", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async (context) => {
  const { appRoot, name, env } = await fixtureApplication(context, "rows", {
    tests: { "a.test.js": FIXTURE_ROWS_TEST("a"), "b.test.js": FIXTURE_ROWS_TEST("b") },
    concurrency: 1
  });
  const { stderr } = await execFileAsync(process.execPath, [JSKIT_CLI, "test", "--databases"], { cwd: appRoot, env });
  assert.match(stderr, /jskit test: 1 test file\(s\) at a time \(test databases\)\./u);
  for (const file of ["a", "b"]) {
    const seen = JSON.parse(await readFile(path.join(appRoot, `seen-${file}.json`), "utf8"));
    assert.deepEqual(seen, { db: name, titles: ["Written by the migration"], review: 1 }, `test file ${file}`);
  }
});

const BROWSER_LAUNCHER = path.join(REPO_ROOT, "tooling", "jskit-catalog", "scripts", "browser-test-servers.mjs");
// The patterns' prepare module: each worker gets its own copy of BROWSER_TEST_DB_NAME.
const BROWSER_PREPARE = `import { prepareTestDatabases } from "@jskit-ai/database-runtime/server/testDatabases";
import knexConfig from "../../knexfile.js";
export default async function prepareBrowserDatabases({ workers }) {
  const { databases } = await prepareTestDatabases({ knexConfig, environment: process.env, variable: "BROWSER_TEST_DB_NAME", count: workers });
  return databases.map((database) => ({ DB_NAME: database }));
}
`;
// An app server: it holds a session on its worker's database until it stops, as a real one's pool does.
const BROWSER_SERVER = `import http from "node:http";
import knex from "knex";
import knexConfig from "./knexfile.js";
const db = knex({ ...knexConfig, pool: { min: 1, max: 1 } });
await db.raw("SELECT 1");
const server = http.createServer((request, response) => response.end("ok")).listen(Number(process.env.PORT), process.env.HOST);
process.once("SIGTERM", async () => {
  server.close();
  await db.destroy();
  process.exit(0);
});
`;

/** A base port whose next `count` ports on 127.0.0.1 are free now. */
async function freePorts(count) {
  const free = (port) => new Promise((resolve) => {
    const probe = net.createServer().once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const base = 20_000 + Math.floor(Math.random() * 30_000);
    if ((await Promise.all(Array.from({ length: count }, (_, index) => free(base + index)))).every(Boolean)) return base;
  }
  throw new Error(`No ${count} free ports in a row.`);
}

test("a browser run's launcher, stopped by SIGTERM, stops its servers within Playwright's grace and keeps BROWSER_TEST_DB_NAME and its copies for the next run", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-browser-"));
  const name = `${process.env.TEST_DB_NAME}_browser`;
  const server = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD };
  const admin = knex({ client: "mysql2", connection: server });
  const candidates = [name, `${name}_0`, `${name}_1`, `${name}_2`];
  let launcher;
  context.after(async () => {
    if (launcher?.exitCode === null) launcher.kill("SIGKILL");
    for (const database of candidates) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    await admin.destroy();
    await rm(appRoot, { recursive: true, force: true });
  });
  const present = async () => (await admin("information_schema.schemata").whereIn("schema_name", candidates).pluck("schema_name")).sort();
  for (const database of candidates) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await mkdir(path.join(appRoot, "tests", "e2e"), { recursive: true });
  await mkdir(path.join(appRoot, "node_modules", "@jskit-ai"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_books.cjs"), BOOKS);
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "browser-fixture", type: "module", private: true }));
  await writeFile(path.join(appRoot, "knexfile.js"), FIXTURE_KNEXFILE);
  await writeFile(path.join(appRoot, ".env"), [`DB_HOST=${server.host}`, `DB_PORT=${server.port}`, `DB_USER=${server.user}`,
    `DB_PASSWORD=${server.password ?? ""}`, ""].join("\n"), { mode: 0o600 });
  await writeFile(path.join(appRoot, "tests", "e2e", "databases.js"), BROWSER_PREPARE);
  await writeFile(path.join(appRoot, "server.mjs"), BROWSER_SERVER);
  await writeFile(path.join(appRoot, "build.mjs"), "import { mkdirSync, writeFileSync } from \"node:fs\";\nmkdirSync(\"dist\", { recursive: true });\nwriteFileSync(\"dist/index.html\", \"<p>ok</p>\");\n");
  await symlink(path.join(REPO_ROOT, "node_modules", "@jskit-ai", "database-runtime"), path.join(appRoot, "node_modules", "@jskit-ai", "database-runtime"), "dir");
  await symlink(path.join(REPO_ROOT, "node_modules", "knex"), path.join(appRoot, "node_modules", "knex"), "dir");
  const workers = 3;
  const settings = { workers, host: "127.0.0.1", basePort: await freePorts(workers), server: `${process.execPath} server.mjs`,
    build: `${process.execPath} build.mjs`, prepare: "tests/e2e/databases.js", env: {}, health: "/",
    workerEnvironments: path.join(appRoot, "test-results", "workers.json") };
  const env = { ...process.env, JSKIT_BROWSER_TESTS: JSON.stringify(settings), BROWSER_TEST_DB_NAME: name,
    DB_NAME: `${name}_application`, DATABASE_URL: "" };
  for (const variable of ["NODE_TEST_CONTEXT", "TEST_DB_NAME", "DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD"]) delete env[variable];

  launcher = spawn(process.execPath, [BROWSER_LAUNCHER], { cwd: appRoot, env, stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  launcher.stdout.on("data", (chunk) => { output += chunk; });
  launcher.stderr.on("data", (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => launcher.once("exit", (code, signal) => resolve(code ?? signal)));
  const deadline = Date.now() + 60_000;
  while (!/jskit browser tests: 3 server\(s\) ready/u.test(output) && launcher.exitCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.match(output, /jskit browser tests: 3 server\(s\) ready/u);
  assert.deepEqual(await present(), [name, `${name}_0`, `${name}_1`, `${name}_2`]);
  await assert.rejects(stat(path.join(appRoot, "node_modules", ".cache", "jskit-test-databases")), { code: "ENOENT" });

  const stopped = performance.now();
  launcher.kill("SIGTERM");
  assert.equal(await exited, 143, output);
  assert.ok(performance.now() - stopped < 10_000, "within the 10 s Playwright gives its webServer to stop");
  assert.doesNotMatch(output, /dropped/u);
  assert.deepEqual(await present(), candidates, "the copies stay for the next run");
});

test("prepareTestDatabases() refuses a test database a test left a view in, naming it", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async (context) => {
  const { appRoot, name, server } = await fixtureApplication(context, "restore", { tests: {}, concurrency: 1 });
  const environment = { ...process.env, DB_NAME: `${name}_application`, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment, appRoot });
  const admin = knex({ client: "mysql2", connection: server });
  context.after(() => admin.destroy());
  await prepareTestDatabases({ knexConfig, environment, appRoot });
  await admin.raw("CREATE VIEW ??.shelf AS SELECT 1 AS id", [name]);
  await assert.rejects(prepareTestDatabases({ knexConfig, environment, appRoot }), { message: new RegExp(`^${name} holds a view`, "u") });
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

test("createPackageTestKnex() on a mysql2 run gives each package test a lettered copy of TEST_DB_NAME of its own, dropped after it", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async (context) => {
  const environment = { ...process.env, DB_CLIENT: "mysql2" };
  const { connection } = createKnexMigrationConfig({ client: "mysql2", environment, appRoot: os.tmpdir() });
  const server = knex({ client: "mysql2", connection: { ...connection, database: undefined } });
  context.after(() => server.destroy());
  const exists = async (database) => (await server("information_schema.schemata").where("schema_name", database).pluck("schema_name")).length > 0;
  const made = [];
  await context.test("two package tests' Knexes at once", async (t) => {
    const knexes = await Promise.all([createPackageTestKnex(t, { environment }), createPackageTestKnex(t, { environment })]);
    for (const [index, db] of knexes.entries()) {
      assert.equal(db.client.config.client, "mysql2");
      const [[database]] = await db.raw("SELECT DATABASE() AS name, @@character_set_database AS charset, @@collation_database AS collation");
      assert.match(database.name, new RegExp(`^${process.env.TEST_DB_NAME}_[a-z]$`, "u"));
      assert.deepEqual([database.charset, database.collation], ["utf8mb4", "utf8mb4_unicode_ci"]);
      made.push(database.name);
      // The same table in each: they share nothing.
      await db.schema.createTable("notes", (table) => { table.bigIncrements("id"); table.string("title"); });
      await db("notes").insert({ title: `note ${index}` });
    }
    assert.equal(new Set(made).size, 2);
    assert.deepEqual(await Promise.all(knexes.map((db) => db("notes").select("id", "title"))), [
      [{ id: "1", title: "note 0" }],
      [{ id: "1", title: "note 1" }]
    ]);
    for (const database of made) assert.equal(await exists(database), true);
  });
  for (const database of made) assert.equal(await exists(database), false, `${database} was dropped after its test`);
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
