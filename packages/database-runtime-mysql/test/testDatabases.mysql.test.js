import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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
    await run.cleanup();
  }

  // The application's own database was never created or touched.
  const [[application]] = await admin.raw("SELECT COUNT(*) AS count FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
    [environment.DB_NAME]);
  assert.equal(Number(application.count), 0);
});

test("a jskit test --databases run on MySQL or MariaDB drops the numbered copies it made when it ends, and keeps TEST_DB_NAME and its snapshot", {
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
  // `_7` is a copy an earlier run left: a run of three files makes only `_1` and `_2`, and drops it as it starts.
  const candidates = [name, `${name}_1`, `${name}_2`, `${name}_7`];
  context.after(async () => {
    for (const database of candidates) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    await admin.destroy();
    await rm(appRoot, { recursive: true, force: true });
  });
  const present = async () => (await admin("information_schema.schemata").whereIn("schema_name", candidates).pluck("schema_name")).sort();
  for (const database of candidates) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
  await admin.raw("CREATE DATABASE ??", [`${name}_7`]);

  const run = await testDatabaseRun({ knexConfig, environment, count: 3, appRoot });
  assert.equal(run.concurrency, 3);
  assert.match(run.summary, new RegExp(`; dropped 1 numbered test database\\(s\\) earlier runs left \\(${name}_7\\)$`, "u"));
  assert.deepEqual(await present(), [name, `${name}_1`, `${name}_2`]);
  const snapshotFile = JSON.parse(await readFile(path.join(run.env.JSKIT_TEST_DATABASES, RUN_SETTINGS_FILE), "utf8")).snapshot.file;
  assert.equal(await run.cleanup(), "dropped the run's 2 numbered test database(s)");
  await assert.rejects(stat(run.env.JSKIT_TEST_DATABASES), { code: "ENOENT" });
  assert.deepEqual(await present(), [name]);
  assert.equal((await stat(snapshotFile)).isFile(), true, "the stored snapshot stays");

  // The next run in the same tree restores the stored snapshot. A copy a session is still connected to stays.
  const next = await testDatabaseRun({ knexConfig, environment, count: 3, appRoot });
  assert.match(next.summary, /stored snapshot/u);
  const holding = knex({ client: "mysql2", connection: { ...server, database: `${name}_2` } });
  try {
    await holding.raw("SELECT 1");
    assert.equal(await next.cleanup(),
      `dropped 1 of the run's 2 numbered test database(s); kept ${name}_2, which a session is connected to`);
  } finally {
    await holding.destroy();
  }
  assert.deepEqual(await present(), [name, `${name}_2`]);

  // A run whose check fails before any test file starts drops its copies as it fails.
  const checkDatabase = async () => {
    throw new Error("a declared foreign key is missing");
  };
  await assert.rejects(testDatabaseRun({ knexConfig, environment, count: 3, appRoot, checkDatabase }), /declared foreign key is missing/u);
  assert.deepEqual(await present(), [name]);
});

// A child process that starts a `jskit test --databases` run of `count` files and then waits, as a run's files do, until
// it is killed: it prints the run's settings directory, which its cleanup would have removed.
const KILLED_RUN = `import { createKnexMigrationConfig } from ${JSON.stringify(import.meta.resolve("@jskit-ai/database-runtime/server/knexMigrationConfig"))};
import { testDatabaseRun } from ${JSON.stringify(import.meta.resolve("@jskit-ai/database-runtime/server/testDatabases"))};
const environment = JSON.parse(process.env.KILLED_RUN_ENVIRONMENT);
const appRoot = process.env.KILLED_RUN_APP_ROOT;
const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment, appRoot });
const run = await testDatabaseRun({ knexConfig, environment, count: Number(process.env.KILLED_RUN_COUNT), appRoot });
process.stdout.write(run.env.JSKIT_TEST_DATABASES + "\\n");
setInterval(() => {}, 1000);
`;

/** Starts KILLED_RUN, waits for its run to start, kills it with SIGKILL, and answers the settings directory it left. */
async function killRunMidway({ environment, appRoot, count }) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", KILLED_RUN], {
    env: { ...process.env, KILLED_RUN_ENVIRONMENT: JSON.stringify(environment), KILLED_RUN_APP_ROOT: appRoot, KILLED_RUN_COUNT: String(count) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve(code ?? signal)));
  const deadline = Date.now() + 60_000;
  while (!output.includes("\n") && child.exitCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill("SIGKILL");
  assert.equal(await exited, "SIGKILL", output);
  return output.trim();
}

test("a jskit test --databases run on MySQL or MariaDB killed mid-way leaves its copies, and the next run's start drops those it does not make itself, but none a session is connected to", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-mysql-killed-"));
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_books.cjs"), BOOKS);
  const name = `${process.env.TEST_DB_NAME}_killed`;
  const environment = { ...process.env, DB_NAME: `${process.env.TEST_DB_NAME}_application`, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment, appRoot });
  const server = { ...knexConfig.connection, database: undefined };
  const admin = knex({ client: "mysql2", connection: server });
  const candidates = [name, `${name}_1`, `${name}_2`, `${name}_3`];
  let settingsDirectory = "";
  context.after(async () => {
    for (const database of candidates) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    await admin.destroy();
    await rm(appRoot, { recursive: true, force: true });
    if (settingsDirectory) await rm(settingsDirectory, { recursive: true, force: true });
  });
  const present = async () => (await admin("information_schema.schemata").whereIn("schema_name", candidates).pluck("schema_name")).sort();
  for (const database of candidates) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);

  // A run of four files killed while they run never reaches its cleanup: its three copies stay.
  settingsDirectory = await killRunMidway({ environment, appRoot, count: 4 });
  assert.match(settingsDirectory, /jskit-test-databases-/u);
  assert.deepEqual(await present(), candidates);

  // The next run, of two files, makes `_1` afresh and drops `_2`; `_3` stays while a session is connected to it.
  const holding = knex({ client: "mysql2", connection: { ...server, database: `${name}_3` } });
  let next;
  try {
    await holding.raw("SELECT 1");
    next = await testDatabaseRun({ knexConfig, environment, count: 2, appRoot });
  } finally {
    await holding.destroy();
  }
  assert.match(next.summary, new RegExp(`; dropped 1 numbered test database\\(s\\) earlier runs left \\(${name}_2\\); ` +
    `kept ${name}_3, which a session is connected to$`, "u"));
  assert.deepEqual(await present(), [name, `${name}_1`, `${name}_3`]);
  assert.equal(await next.cleanup(), "dropped the run's 1 numbered test database(s)");

  // Once nothing is connected to it, the next run's start drops it too: nothing a killed run made outlives it.
  const last = await testDatabaseRun({ knexConfig, environment, count: 1, appRoot });
  assert.match(last.summary, new RegExp(`; dropped 1 numbered test database\\(s\\) earlier runs left \\(${name}_3\\)$`, "u"));
  assert.equal(await last.cleanup(), "");
  assert.deepEqual(await present(), [name]);
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
    for (const database of [name, `${name}_1`]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
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
// password as a digest) and the database a package data test of its gets with the file's own environment, which names
// the run's database client.
const FIXTURE_TEST = (name, other) => `import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import test from "node:test";
import { createPackageTestKnex } from "@jskit-ai/database-runtime/server/testDatabases";
test("${name}", async (t) => {
  writeFileSync("started-${name}", "");
  const deadline = Date.now() + 30000;
  while (!existsSync("started-${other}") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  const own = await createPackageTestKnex(t, { environment: process.env });
  const [[{ packageDatabase }]] = await own.raw("SELECT DATABASE() AS packageDatabase");
  writeFileSync("seen-${name}.json", JSON.stringify({ packageDatabase, client: process.env.DB_CLIENT ?? null,
    db: process.env.DB_NAME, test: process.env.TEST_DB_NAME, settings: process.env.JSKIT_TEST_DATABASES ?? null,
    dotenv: process.env.FIXTURE_ONLY_IN_DOTENV ?? null, other: existsSync("started-${other}"),
    connection: { host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
      password: createHash("sha256").update(process.env.DB_PASSWORD ?? "(none)").digest("hex") }
  }));
});
`;
// Each file records the books it found, then writes one of its own.
const FIXTURE_ROWS_TEST = (name) => `import { writeFileSync } from "node:fs";
import test from "node:test";
import knex from "knex";
test("${name}", async () => {
  const { DB_HOST: host, DB_PORT: port, DB_USER: user, DB_PASSWORD: password, DB_NAME: database } = process.env;
  const db = knex({ client: "mysql2", connection: { host, port: Number(port), user, password, database } });
  try {
    writeFileSync("seen-${name}.json", JSON.stringify({ db: database, titles: await db("books").orderBy("id").pluck("title") }));
    await db("books").insert({ title: "Written by ${name}" });
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
    for (const database of [name, `${name}_1`, `${name}_a`, `${name}_b`]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
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
  for (const { db, test: testDatabase, settings, dotenv, other, connection: given, packageDatabase, client } of seen) {
    assert.equal(testDatabase, db);
    // The run's knexfile fixes the client; the file gets it with its database, so its package data tests use it too.
    assert.equal(client, "mysql2");
    // A package data test claims a lettered copy of the run's designated database, not of the file's numbered copy.
    assert.match(packageDatabase, new RegExp(`^${name}_[a-z]$`, "u"));
    assert.equal(settings, null);
    assert.equal(dotenv, null);
    assert.equal(other, true);
    assert.deepEqual(given, connection);
  }
  // The run ends by dropping its copy, and keeps TEST_DB_NAME, restored from the snapshot.
  assert.match(stderr, /jskit test: dropped the run's 1 numbered test database\(s\)\./u);
  const admin = knex({ client: "mysql2", connection: server });
  try {
    assert.deepEqual(await admin("information_schema.schemata").whereIn("schema_name", [name, `${name}_1`]).pluck("schema_name"), [name]);
    assert.deepEqual(await admin(`${name}.books`).pluck("title"), ["Written by the migration"]);
  } finally {
    await admin.destroy();
  }

  // A focused run of one file prepares one database, from the stored snapshot.
  const focused = await execFileAsync(process.execPath, [JSKIT_CLI, "test", "--databases", "test/a.test.js"], { cwd: appRoot, env });
  assert.match(focused.stderr, /jskit test: 1 test database\(s\) from .+_cli ready in \d+ms: stored snapshot/u);
});

test("jskit test --databases gives a file that follows another on the same copy the snapshot again, rows included", {
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
    assert.deepEqual(seen, { db: name, titles: ["Written by the migration"] }, `test file ${file}`);
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

test("a browser run's launcher, stopped by SIGTERM, drops the numbered copies of BROWSER_TEST_DB_NAME its prepare module made once its servers stop, and keeps BROWSER_TEST_DB_NAME and its snapshot", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-browser-"));
  const name = `${process.env.TEST_DB_NAME}_browser`;
  const server = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD };
  const admin = knex({ client: "mysql2", connection: server });
  // `_7` is a copy an earlier run left: a run of three workers makes only `_1` and `_2`, and drops it as it starts.
  const candidates = [name, `${name}_1`, `${name}_2`, `${name}_7`];
  let launcher;
  context.after(async () => {
    if (launcher?.exitCode === null) launcher.kill("SIGKILL");
    for (const database of candidates) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    await admin.destroy();
    await rm(appRoot, { recursive: true, force: true });
  });
  const present = async () => (await admin("information_schema.schemata").whereIn("schema_name", candidates).pluck("schema_name")).sort();
  for (const database of candidates) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
  await admin.raw("CREATE DATABASE ??", [`${name}_7`]);
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
  assert.deepEqual(await present(), [name, `${name}_1`, `${name}_2`]);
  const cache = path.join(appRoot, "node_modules", ".cache", "jskit-test-databases");
  const snapshots = (await readdir(cache)).filter((file) => file.endsWith(".json"));
  assert.equal(snapshots.length, 1);

  const stopped = performance.now();
  launcher.kill("SIGTERM");
  assert.equal(await exited, 143, output);
  assert.ok(performance.now() - stopped < 10_000, "within the 10 s Playwright gives its webServer to stop");
  assert.match(output, /\[browser-tests\] dropped the run's 2 numbered test database\(s\)\./u);
  assert.deepEqual(await present(), [name]);
  assert.deepEqual((await readdir(cache)).filter((file) => file.endsWith(".json")), snapshots, "the stored snapshot stays");

  // prepareTestDatabases() drops the copies it made when it throws: here its seed.
  const environment = { ...process.env, DB_NAME: `${name}_application`, DATABASE_URL: "", BROWSER_TEST_DB_NAME: name };
  delete environment.TEST_DB_NAME;
  const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment, appRoot });
  // The designated database's seed fails at once while the copies' still run: their sessions end before the drop.
  const seed = async (trx) => {
    const [[{ name: database }]] = await trx.raw("SELECT DATABASE() AS name");
    if (database === name) throw new Error("the seed failed");
    await new Promise((resolve) => setTimeout(resolve, 500));
  };
  await assert.rejects(prepareTestDatabases({ knexConfig, environment, variable: "BROWSER_TEST_DB_NAME", count: 3, seed, appRoot }),
    /the seed failed/u);
  assert.deepEqual(await present(), [name]);
});

test("prepareTestDatabases() drops the numbered copies it made when a restore throws, once every restore has ended", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async (context) => {
  const { appRoot, name, server } = await fixtureApplication(context, "restore", { tests: {}, concurrency: 1 });
  const environment = { ...process.env, DB_NAME: `${name}_application`, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment, appRoot });
  const admin = knex({ client: "mysql2", connection: server, pool: { min: 0, max: 2 } });
  const copies = [`${name}_1`, `${name}_2`];
  context.after(async () => {
    for (const database of copies) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    await admin.destroy();
  });
  const present = async () => (await admin("information_schema.schemata").whereIn("schema_name", [name, ...copies])
    .pluck("schema_name")).sort();
  await prepareTestDatabases({ knexConfig, environment, appRoot });
  // TEST_DB_NAME's restore fails at once (a view), while a session reading the copies holds their restores back.
  await admin.raw("CREATE VIEW ??.shelf AS SELECT 1 AS id", [name]);
  for (const copy of copies) {
    await admin.raw("CREATE DATABASE ??", [copy]);
    await admin.raw("CREATE TABLE ??.held (id INT)", [copy]);
  }
  const reader = await admin.transaction();
  for (const copy of copies) await reader.raw("SELECT * FROM ??.held", [copy]);
  const preparing = prepareTestDatabases({ knexConfig, environment, count: 3, appRoot }).then(() => null, (error) => error);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await reader.commit();
  assert.match((await preparing)?.message ?? "(it did not throw)", new RegExp(`^${name} holds a view`, "u"));
  assert.deepEqual(await present(), [name]);
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
