import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
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
      await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
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
  await assert.rejects(proveMigrationHistory({ knexConfig, environment, appRoot }), new RegExp(
    `^Error: The migration history proof: ${name}, built from empty, differs from the test snapshot in books: `, "u"));
  assert.deepEqual(await restoreTestDatabase(knexConfig, name, snapshot), []);
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

test("jskit migration-history proves an application's history from its knexfile.js, and fails, saying why, when it differs", {
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
  for (const variable of ["NODE_TEST_CONTEXT", "DB_CLIENT", "DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD"]) delete env[variable];

  const { stdout } = await execFileAsync(process.execPath, [JSKIT_CLI, "migration-history"], { cwd: appRoot, env });
  assert.match(stdout, new RegExp(`^jskit migration-history: 1 migrations replayed from empty into ${name} in \\d+ms, ` +
    "nothing left for a second pass, the same tables, definitions and rows as the test snapshot \\(4 tables\\)\\n$", "u"));
  assert.deepEqual(await admin(`${name}.books`).pluck("title"), ["Written by the migration"]);

  await writeFile(path.join(appRoot, "migrations", "20200102000000_random_book.cjs"), RANDOM_BOOK);
  await assert.rejects(execFileAsync(process.execPath, [JSKIT_CLI, "migration-history"], { cwd: appRoot, env }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /^jskit migration-history: The migration history proof: .+ differs from the test snapshot in books: /mu);
    return true;
  });
});
