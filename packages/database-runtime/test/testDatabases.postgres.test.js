import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import knexFactory from "knex";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { DatabaseProvider } from "../src/server/providers/DatabaseProvider.js";
import { createKnexMigrationConfig } from "../src/server/knexMigrationConfig.js";
import {
  RUN_SETTINGS_FILE,
  countQueries,
  countRuntimeQueries,
  createPackageTestKnex,
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

// Two indexed tables: parts filled by the migration, labels left empty for a seed.
const PARTS = `exports.up = async (knex) => {
  await knex.schema.createTable("parts", (table) => { table.increments("id"); table.string("code").index(); });
  await knex.schema.createTable("labels", (table) => { table.increments("id"); table.string("text").index(); });
  await knex("parts").insert(Array.from({ length: 300 }, (_, index) => ({ code: "part-" + index })));
};
exports.down = () => {};
`;

test("on PostgreSQL every copy carries the snapshot's planner statistics, and a seed's tables are sampled again", {
  skip: SKIP
}, async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-pg-statistics-"));
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_parts.cjs"), PARTS);
  const name = `${TEST_DB_NAME}_statistics`;
  const environment = { ...process.env, DB_CLIENT: "pg", DB_NAME: TEST_DB_NAME, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "pg", environment, appRoot });
  const on = (database) => knexFactory({ client: "pg", connection: { ...knexConfig.connection, database } });
  context.after(async () => {
    const admin = on(TEST_DB_NAME);
    try {
      for (const database of [name, `${name}_1`, `${name}_snapshot`]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    } finally {
      await admin.destroy();
    }
    await rm(appRoot, { recursive: true, force: true });
  });
  const seed = (transaction) => transaction("labels").insert(Array.from({ length: 300 }, (_, index) => ({ text: `label-${index}` })));

  const { databases } = await prepareTestDatabases({ knexConfig, environment, count: 2, seed, appRoot });
  for (const database of databases) {
    const db = on(database);
    try {
      // The planner's column statistics, which only ANALYZE (or autovacuum, much later) writes: a copy of a template
      // takes the template's.
      const { rows } = await db.raw("SELECT tablename AS name FROM pg_stats WHERE schemaname = current_schema() AND " +
        "attname IN ('code', 'text') ORDER BY tablename");
      assert.deepEqual(rows.map((row) => row.name), ["labels", "parts"], database);
    } finally {
      await db.destroy();
    }
  }
});

test("a jskit test --databases run on PostgreSQL keeps its copies for the next run, whatever its count, which makes each again from the snapshot", {
  skip: SKIP
}, async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-pg-run-"));
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_books.cjs"), BOOKS);
  const name = `${TEST_DB_NAME}_run`;
  const environment = { ...process.env, DB_CLIENT: "pg", DB_NAME: TEST_DB_NAME, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "pg", environment, appRoot });
  const on = (database) => knexFactory({ client: "pg", connection: { ...knexConfig.connection, database } });
  const candidates = [name, `${name}_1`, `${name}_2`, `${name}_snapshot`];
  const admin = on(TEST_DB_NAME);
  // Every database the runs left under this name, whatever it is called.
  const left = async () => (await admin("pg_database").where("datname", "like", `${name.replaceAll("_", "\\_")}%`)
    .pluck("datname")).sort();
  context.after(async () => {
    try {
      for (const database of new Set([...candidates, ...await left()])) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    } finally {
      await admin.destroy();
    }
    await rm(appRoot, { recursive: true, force: true });
  });
  const present = async () => (await admin("pg_database").whereIn("datname", candidates).pluck("datname")).sort();
  for (const database of candidates) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);

  // Each database is a copy of the snapshot's three tables: books and the migration ledger's two.
  const run = await testDatabaseRun({ knexConfig, environment, count: 3, appRoot });
  assert.equal(run.concurrency, 3);
  assert.match(run.summary, /, restore \d+ms of 9 table\(s\)$/u);
  await run.cleanup();
  assert.equal(existsSync(run.env.JSKIT_TEST_DATABASES), false);
  assert.deepEqual(await present(), candidates, "the copies stay for the next run");

  // A file of that run wrote a book in `_2`: the next run gives it the snapshot's again.
  const copy = on(`${name}_2`);
  try {
    await copy("books").insert({ title: "Written by a file" });
  } finally {
    await copy.destroy();
  }
  const next = await testDatabaseRun({ knexConfig, environment, count: 3, appRoot });
  assert.match(next.summary, /: stored snapshot, restore \d+ms of 9 table\(s\)$/u);
  const restored = on(`${name}_2`);
  try {
    assert.deepEqual(await restored("books").pluck("title"), ["Written by the migration"]);
  } finally {
    await restored.destroy();
  }
  await next.cleanup();

  // A focused run of one file leaves the copies the whole runs use, and so does a run whose check fails.
  const focused = await testDatabaseRun({ knexConfig, environment, count: 1, appRoot });
  await focused.cleanup();
  const checkDatabase = async () => {
    throw new Error("a declared foreign key is missing");
  };
  await assert.rejects(testDatabaseRun({ knexConfig, environment, count: 3, appRoot, checkDatabase }), /declared foreign key is missing/u);

  // A changed migration takes a new snapshot in the same `_snapshot`, and a run of two files makes the two databases it
  // takes from it; `_2`, which it does not take, keeps the old schema until a run takes it.
  await writeFile(path.join(appRoot, "migrations", "20200102000000_shelves.cjs"),
    "exports.up = (knex) => knex.schema.createTable(\"shelves\", (table) => table.increments(\"id\"));\nexports.down = () => {};\n");
  const changed = await testDatabaseRun({ knexConfig, environment, count: 2, appRoot });
  assert.match(changed.summary, /2 migrations replayed once for a new snapshot, restore \d+ms of 8 table\(s\)$/u);
  await changed.cleanup();
  // Whatever the runs' counts and schemas, one database per slot a run took, and the snapshot: never one per run.
  assert.deepEqual(await left(), candidates);
  const whole = await testDatabaseRun({ knexConfig, environment, count: 3, appRoot });
  assert.match(whole.summary, /: stored snapshot, restore \d+ms of 12 table\(s\)$/u);
  await whole.cleanup();
  const third = on(`${name}_2`);
  try {
    assert.deepEqual(await third("pg_tables").where({ schemaname: "public", tablename: "shelves" }).pluck("tablename"), ["shelves"]);
  } finally {
    await third.destroy();
  }
  assert.deepEqual(await left(), candidates);
});

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const BROWSER_LAUNCHER = path.join(REPO_ROOT, "tooling", "jskit-catalog", "scripts", "browser-test-servers.mjs");
const BROWSER_KNEXFILE = `import { createKnexMigrationConfig } from "@jskit-ai/database-runtime/server/knexMigrationConfig";
process.loadEnvFile(".env");
export default createKnexMigrationConfig({ client: "pg", environment: process.env });
`;
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

test("a browser run's launcher on PostgreSQL, stopped by SIGTERM, stops its servers within Playwright's grace and keeps BROWSER_TEST_DB_NAME and its copies for the next run", {
  skip: SKIP
}, async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-pg-browser-"));
  const name = `${TEST_DB_NAME}_browser`;
  const { connection } = createKnexMigrationConfig({ client: "pg", environment: { ...process.env, DB_CLIENT: "pg" }, appRoot });
  const admin = knexFactory({ client: "pg", connection });
  const candidates = [name, `${name}_1`, `${name}_2`, `${name}_snapshot`];
  let launcher;
  context.after(async () => {
    if (launcher?.exitCode === null) launcher.kill("SIGKILL");
    try {
      for (const database of candidates) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    } finally {
      await admin.destroy();
    }
    await rm(appRoot, { recursive: true, force: true });
  });
  const present = async () => (await admin("pg_database").whereIn("datname", candidates).pluck("datname")).sort();
  for (const database of candidates) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await mkdir(path.join(appRoot, "tests", "e2e"), { recursive: true });
  await mkdir(path.join(appRoot, "node_modules", "@jskit-ai"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_books.cjs"), BOOKS);
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "browser-fixture", type: "module", private: true }));
  await writeFile(path.join(appRoot, "knexfile.js"), BROWSER_KNEXFILE);
  await writeFile(path.join(appRoot, ".env"), [`DB_HOST=${connection.host}`, `DB_PORT=${connection.port ?? 5432}`, `DB_USER=${connection.user}`,
    `DB_PASSWORD=${connection.password ?? ""}`, ""].join("\n"), { mode: 0o600 });
  await writeFile(path.join(appRoot, "tests", "e2e", "databases.js"), BROWSER_PREPARE);
  await writeFile(path.join(appRoot, "server.mjs"), BROWSER_SERVER);
  await writeFile(path.join(appRoot, "build.mjs"), "import { mkdirSync, writeFileSync } from \"node:fs\";\nmkdirSync(\"dist\", { recursive: true });\nwriteFileSync(\"dist/index.html\", \"<p>ok</p>\");\n");
  await symlink(path.join(REPO_ROOT, "node_modules", "@jskit-ai", "database-runtime"), path.join(appRoot, "node_modules", "@jskit-ai", "database-runtime"), "dir");
  await symlink(path.join(REPO_ROOT, "node_modules", "knex"), path.join(appRoot, "node_modules", "knex"), "dir");
  const workers = 3;
  const settings = { workers, host: "127.0.0.1", basePort: await freePorts(workers), server: `${process.execPath} server.mjs`,
    build: `${process.execPath} build.mjs`, prepare: "tests/e2e/databases.js", env: {}, health: "/",
    workerEnvironments: path.join(appRoot, "test-results", "workers.json") };
  // The application's database is TEST_DB_NAME, which the browser run's copies are made beside.
  const env = { ...process.env, JSKIT_BROWSER_TESTS: JSON.stringify(settings), BROWSER_TEST_DB_NAME: name, DB_CLIENT: "pg",
    DB_NAME: TEST_DB_NAME, DATABASE_URL: "" };
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
  assert.deepEqual(await present(), [name, `${name}_1`, `${name}_2`, `${name}_snapshot`]);

  const stopped = performance.now();
  launcher.kill("SIGTERM");
  assert.equal(await exited, 143, output);
  assert.ok(performance.now() - stopped < 10_000, "within the 10 s Playwright gives its webServer to stop");
  assert.doesNotMatch(output, /dropped/u);
  assert.deepEqual(await present(), candidates, "the copies stay for the next run");
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

// The contract a managed host gives on PostgreSQL (Vibe64 Online's project roles): a role that may create databases,
// and nothing more, runs 16 files at once, each on a copy it makes, and their package tests.
test("a jskit test --databases run of 16 files at once on PostgreSQL needs only a role that may create databases", {
  skip: SKIP
}, async (context) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-pg-sixteen-"));
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  await writeFile(path.join(appRoot, "migrations", "20200101000000_books.cjs"), BOOKS);
  const name = `${TEST_DB_NAME}_sixteen`;
  const copies = Array.from({ length: 15 }, (_, index) => `${name}_${index + 1}`);
  const role = `jskit_createdb_${randomBytes(4).toString("hex")}`;
  const password = randomBytes(12).toString("hex");
  const server = { ...process.env, DB_CLIENT: "pg", DB_NAME: TEST_DB_NAME, DATABASE_URL: "" };
  const admin = knexFactory({ client: "pg", connection: createKnexMigrationConfig({ client: "pg", environment: server, appRoot }).connection });
  context.after(async () => {
    try {
      for (const database of [name, ...copies, `${name}_snapshot`]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
      await admin.raw("DROP ROLE IF EXISTS ??", [role]);
    } finally {
      await admin.destroy();
      await rm(appRoot, { recursive: true, force: true });
    }
  });
  // Hexadecimal, so safe inline: CREATE ROLE takes no bound parameters.
  await admin.raw(`CREATE ROLE ?? LOGIN CREATEDB PASSWORD '${password}'`, [role]);
  // A role signs in with its password over TCP: a server reached through its socket directory takes it on 127.0.0.1.
  const host = String(process.env.DB_HOST || "").startsWith("/") ? "127.0.0.1" : process.env.DB_HOST;
  const environment = { ...server, DB_HOST: host, DB_USER: role, DB_PASSWORD: password, TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "pg", environment, appRoot });
  const run = await testDatabaseRun({ knexConfig, environment, count: 16, appRoot });
  try {
    assert.deepEqual([run.concurrency, run.shortfall], [16, ""]);
    const settings = JSON.parse(await readFile(path.join(run.env.JSKIT_TEST_DATABASES, RUN_SETTINGS_FILE), "utf8"));
    assert.deepEqual(settings.databases, [name, ...copies]);
    await context.test("a package test in the run's sixteenth file", async (t) => {
      const db = await createPackageTestKnex(t, { environment: { ...environment, DB_NAME: copies[14], TEST_DB_NAME: copies[14] } });
      assert.equal((await db.raw("SELECT current_database() AS name")).rows[0].name, copies[14]);
      await db.schema.createTable("notes", (table) => table.increments());
      assert.deepEqual(await db("notes").select(), []);
    });
  } finally {
    await run.cleanup();
  }
});
