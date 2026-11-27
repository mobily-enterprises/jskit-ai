import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import knex from "knex";
import { createKnexMigrationConfig } from "@jskit-ai/database-runtime/server/knexMigrationConfig";
import {
  prepareTestDatabases,
  proveMigrationHistory,
  restoreTestDatabase
} from "@jskit-ai/database-runtime/server/testDatabases";

// The full-history migration proof on MySQL and MariaDB. Test runs restore TEST_DB_NAME and its copies from a stored
// snapshot and never replay the migrations, so this is the one check that every migration still builds the schema
// from empty on this server, and that the snapshot the tests run on is what they build.
const SKIP = !process.env.TEST_DB_NAME || !process.env.DB_HOST;
const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const JSKIT_CLI = path.join(REPO_ROOT, "tooling", "jskit-catalog", "scripts", "jskit.mjs");
// It notes each replay in replays.log beside the migrations directory.
const BOOKS = `exports.up = async (knex) => {
  require("node:fs").appendFileSync(require("node:path").join(__dirname, "..", "replays.log"), "replayed\\n");
  await knex.schema.createTable("books", (table) => { table.increments("id"); table.string("title"); });
  await knex.schema.createTable("reviews", (table) => { table.increments("id"); table.integer("book_id").unsigned().references("books.id"); });
  await knex("books").insert({ title: "Written by the migration" });
};
exports.down = () => {};
`;
// A migration that writes another row on each replay, as one that reads the clock or a random value does.
const RANDOM_BOOK = "exports.up = (knex) => knex(\"books\").insert({ title: require(\"node:crypto\").randomUUID() });\n" +
  "exports.down = () => {};\n";
// Seed rows filled from the clock, as a migration that has run cannot stop doing: a column default, NOW(), the current
// month and JavaScript's Date.
const CLOCK = `exports.up = async (knex) => {
  await knex.schema.createTable("presets", (table) => {
    table.increments("id");
    table.string("name");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.date("month");
    table.dateTime("noted_at");
  });
  await knex.raw("INSERT INTO presets (name, month, noted_at) VALUES ('Core Coach', DATE_FORMAT(NOW(), '%Y-%m-01'), ?)", [new Date()]);
};
exports.down = () => {};
`;
// A settings row a migration seeds with knex.fn.now() (SQL's CURRENT_TIMESTAMP) beside JavaScript's Date, as
// BeePollen's console_settings, allowed_login_email_settings and driers migrations do.
const SETTINGS = `exports.up = async (knex) => {
  await knex.schema.createTable("console_settings", (table) => {
    table.increments("id");
    table.string("name");
    table.dateTime("created_at");
    table.dateTime("updated_at");
  });
  await knex("console_settings").insert({ name: "default", created_at: knex.fn.now(), updated_at: new Date() });
};
exports.down = () => {};
`;
const SHELF_COLOUR = "exports.up = (knex) => knex.schema.alterTable(\"shelves\", (table) => table.string(\"colour\"));\n" +
  "exports.down = () => {};\n";
const KNEXFILE = `import { createKnexMigrationConfig } from "@jskit-ai/database-runtime/server/knexMigrationConfig";
try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
export default createKnexMigrationConfig({ client: "mysql2", environment: process.env });
`;

/**
 * An application in a directory of its own with `migrations`, whose TEST_DB_NAME is named after `suffix` and is dropped
 * after the test, with the directory.
 * @param {import("node:test").TestContext} context
 * @param {string} suffix
 * @param {Record<string, string>} migrations
 */
async function application(context, suffix, migrations) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), `jskit-migration-history-${suffix}-`));
  const name = `${process.env.TEST_DB_NAME}_${suffix}`;
  const server = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD };
  const admin = knex({ client: "mysql2", connection: server, pool: { min: 0, max: 1 } });
  context.after(async () => {
    try {
      for (const database of [name, `${name}_0`]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    } finally {
      await admin.destroy();
      await rm(appRoot, { recursive: true, force: true });
    }
  });
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  for (const [file, source] of Object.entries(migrations)) await writeFile(path.join(appRoot, "migrations", file), source);
  // The application's own database is one this test never creates.
  const environment = { ...process.env, DB_NAME: `${name}_application`, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment, appRoot });
  const replays = async () => (await readFile(path.join(appRoot, "replays.log"), "utf8")).split("\n").filter(Boolean).length;
  return { appRoot, name, server, admin, environment, knexConfig, replays };
}

test("the migration history proof replays every migration from empty into TEST_DB_NAME, finds nothing left for a second pass, matches the test snapshot, and leaves TEST_DB_NAME as the snapshot", {
  skip: SKIP
}, async (context) => {
  const { appRoot, name, admin, environment, knexConfig, replays } = await application(context, "hist1", {
    "20200101000000_books.cjs": BOOKS
  });
  await prepareTestDatabases({ knexConfig, environment, appRoot });
  assert.equal(await replays(), 1, "the snapshot was built once");
  // A test file left a row and a table of its own in TEST_DB_NAME.
  await admin.raw("INSERT INTO ??.books (title) VALUES ('Left by a test')", [name]);
  await admin.raw("CREATE TABLE ??.scratch (id INT)", [name]);

  const proof = await proveMigrationHistory({ knexConfig, environment, appRoot });
  assert.match(proof.summary, new RegExp(`^1 migrations replayed from empty into ${name} in \\d+ms, nothing left for a ` +
    "second pass, the same tables, definitions and rows as the test snapshot \\(4 tables\\)$", "u"));
  assert.equal(await replays(), 2, "the proof replayed the history itself, from the stored snapshot's run");
  assert.deepEqual(await admin("information_schema.TABLES").where("TABLE_SCHEMA", name).orderBy("TABLE_NAME").pluck("TABLE_NAME"),
    ["books", "knex_migrations", "knex_migrations_lock", "reviews"]);
  assert.deepEqual(await admin(`${name}.books`).pluck("title"), ["Written by the migration"]);
});

test("a migration history that builds other rows on each replay fails the proof, naming the table, and leaves TEST_DB_NAME as the snapshot", {
  skip: SKIP
}, async (context) => {
  const { appRoot, name, environment, knexConfig } = await application(context, "hist2", {
    "20200101000000_books.cjs": BOOKS,
    "20200102000000_random_book.cjs": RANDOM_BOOK
  });
  const { snapshot } = await prepareTestDatabases({ knexConfig, environment, appRoot });
  // The rows that differ are named, as read.
  await assert.rejects(proveMigrationHistory({ knexConfig, environment, appRoot }), new RegExp(
    `^Error: The migration history proof: ${name}, built from empty, differs from the test snapshot in books: books: 1 row\\(s\\) ` +
    'only in the replay \\(\\{"id":2,"title":"[0-9a-f-]{36}"\\}\\) and 1 only in the snapshot \\(\\{"id":2,"title":"[0-9a-f-]{36}"\\}\\)\\. ' +
    "A migration builds something else on each replay \\(.*SYSDATE\\(\\)", "u"));
  assert.deepEqual(await restoreTestDatabase(knexConfig, name, snapshot), []);
});

test("a migration history whose seed rows come from the clock (a column default, NOW(), knex.fn.now(), the month, JavaScript's Date) passes the proof at another second, the clock frozen at the snapshot's own", {
  skip: SKIP
}, async (context) => {
  const { appRoot, name, admin, environment, knexConfig } = await application(context, "hist5", {
    "20200101000000_clock.cjs": CLOCK,
    "20200102000000_settings.cjs": SETTINGS
  });
  const { snapshot } = await prepareTestDatabases({ knexConfig, environment, appRoot });
  const preset = async () => (await admin.raw("SELECT UNIX_TIMESTAMP(created_at) AS created, CAST(month AS CHAR) AS month, " +
    "CAST(noted_at AS CHAR) AS noted FROM ??.presets", [name]))[0][0];
  const built = await preset();
  const settings = async () => (await admin.raw("SELECT CAST(created_at AS CHAR) AS created, CAST(updated_at AS CHAR) AS updated " +
    "FROM ??.console_settings", [name]))[0];
  const seeded = await settings();
  // The server's clock moves on to another second before the proof replays the history.
  for (const deadline = Date.now() + 5000; Date.now() < deadline; await delay(50)) {
    if (Number((await admin.raw("SELECT UNIX_TIMESTAMP() AS now"))[0][0].now) > Number(built.created)) break;
  }
  const proof = await proveMigrationHistory({ knexConfig, environment, appRoot });
  assert.match(proof.summary, /, the same tables, definitions and rows as the test snapshot \(4 tables\)$/u);
  assert.deepEqual(await preset(), built);
  assert.deepEqual(await settings(), seeded);
  assert.equal(snapshot.clock, Number(built.created));
  // A snapshot database without its label, as a build that never finished leaves it, is built again.
  await admin.raw("DROP TABLE ??.jskit_test_snapshot", [`${name}_0`]);
  const again = await prepareTestDatabases({ knexConfig, environment, appRoot });
  assert.match(again.summary, / 2 migrations replayed once for a new snapshot, /u);
});

test("a schema build that leaves a migration unapplied fails the migration history proof, naming the migration", {
  skip: SKIP
}, async (context) => {
  const { appRoot, name, environment, knexConfig } = await application(context, "hist3", {
    "20200101000000_shelf_colour.cjs": SHELF_COLOUR
  });
  // A baseline schema with no ledger, whose migrations nothing runs.
  const schema = { files: [], build: (db) => db.schema.createTable("shelves", (table) => table.increments("id")) };
  const { snapshot } = await prepareTestDatabases({ knexConfig, environment, schema, appRoot });
  await assert.rejects(proveMigrationHistory({ knexConfig, environment, schema, appRoot }), new RegExp(
    `^Error: The migration history proof: a second pass over ${name} applied 1 migration\\(s\\) the schema build left: ` +
    "20200101000000_shelf_colour\\.cjs", "u"));
  assert.deepEqual(await restoreTestDatabase(knexConfig, name, snapshot), []);
});

test("jskit migration-history proves an application's history from its knexfile.js as APP_ENV=test, refuses a staging or production shell, and fails, saying why, when it differs", {
  skip: SKIP
}, async (context) => {
  const { appRoot, name, server, admin } = await application(context, "hist4", { "20200101000000_books.cjs": BOOKS });
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "hist4-fixture", type: "module", private: true }));
  await writeFile(path.join(appRoot, "knexfile.js"), KNEXFILE);
  await writeFile(path.join(appRoot, ".env"), [`DB_HOST=${server.host}`, `DB_PORT=${server.port}`, `DB_USER=${server.user}`,
    `DB_PASSWORD=${server.password ?? ""}`, ""].join("\n"), { mode: 0o600 });
  await mkdir(path.join(appRoot, "node_modules"));
  await symlink(path.join(REPO_ROOT, "node_modules", "@jskit-ai"), path.join(appRoot, "node_modules", "@jskit-ai"), "dir");
  await symlink(path.join(REPO_ROOT, "node_modules", "knex"), path.join(appRoot, "node_modules", "knex"), "dir");
  const env = { ...process.env, DB_NAME: `${name}_application`, TEST_DB_NAME: name, DATABASE_URL: "" };
  // A shell that names no APP_ENV, as CI's, runs the proof as APP_ENV=test, as `jskit test` runs tests.
  for (const variable of ["NODE_TEST_CONTEXT", "DB_CLIENT", "DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "APP_ENV"]) delete env[variable];

  const { stdout } = await execFileAsync(process.execPath, [JSKIT_CLI, "migration-history"], { cwd: appRoot, env });
  assert.match(stdout, new RegExp(`^jskit migration-history: 1 migrations replayed from empty into ${name} in \\d+ms, ` +
    "nothing left for a second pass, the same tables, definitions and rows as the test snapshot \\(4 tables\\)\\n$", "u"));
  assert.deepEqual(await admin(`${name}.books`).pluck("title"), ["Written by the migration"]);
  await assert.rejects(execFileAsync(process.execPath, [JSKIT_CLI, "migration-history"], { cwd: appRoot, env: { ...env, APP_ENV: "production" } }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /^jskit migration-history runs tests with APP_ENV=test, and APP_ENV is production here: /u);
      return true;
    });

  await writeFile(path.join(appRoot, "migrations", "20200102000000_random_book.cjs"), RANDOM_BOOK);
  await assert.rejects(execFileAsync(process.execPath, [JSKIT_CLI, "migration-history"], { cwd: appRoot, env }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /^jskit migration-history: The migration history proof: .+ differs from the test snapshot in books: /mu);
    return true;
  });
});
