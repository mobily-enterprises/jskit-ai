import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import knexFactory from "knex";
import { createKnexMigrationConfig } from "../src/server/knexMigrationConfig.js";
import { prepareTestDatabases, proveMigrationHistory } from "../src/server/testDatabases.js";

// The full-history migration proof on PostgreSQL. Runs beside the PostgreSQL test database: run with DB_NAME set to
// TEST_DB_NAME (and the usual DB_HOST, DB_PORT, DB_USER and DB_PASSWORD), DB_CLIENT unset or pg, and a database user
// that may create databases (CREATEDB).
const TEST_DB_NAME = process.env.TEST_DB_NAME?.trim();
const ON_TEST_DATABASE = Boolean(TEST_DB_NAME) && process.env.DB_NAME === TEST_DB_NAME;
const POSTGRES_CLIENT = !process.env.DB_CLIENT || process.env.DB_CLIENT === "pg";
const SKIP = ON_TEST_DATABASE && POSTGRES_CLIENT ? false : "not on a PostgreSQL test database (DB_NAME=$TEST_DB_NAME)";

// It notes each replay in replays.log beside the migrations directory.
const BOOKS = `exports.up = async (knex) => {
  require("node:fs").appendFileSync(require("node:path").join(__dirname, "..", "replays.log"), "replayed\\n");
  await knex.schema.createTable("books", (table) => { table.increments("id"); table.string("title"); });
  await knex("books").insert({ title: "Written by the migration" });
};
exports.down = () => {};
`;
// Each replay builds another row, column default, CHECK constraint and index, as a migration reading the clock does.
const RANDOM = `exports.up = async (knex) => {
  const random = () => require("node:crypto").randomBytes(4).toString("hex");
  await knex("books").insert({ title: random() });
  await knex.schema.createTable("labels", (table) => { table.increments("id"); table.string("code").defaultTo(random()); });
  await knex.schema.createTable("limits", (table) => { table.increments("id"); table.integer("size"); });
  await knex.raw(\`ALTER TABLE limits ADD CHECK (size < \${parseInt(random(), 16)})\`);
  await knex.schema.createTable("tags", (table) => { table.increments("id"); table.string("name"); });
  await knex.raw(\`CREATE INDEX tags_\${random()} ON tags (name)\`);
};
exports.down = () => {};
`;

// Seed rows filled from the clock, as a migration that has run cannot stop doing: column defaults (a time with and
// without its zone, the day) and JavaScript's Date.
const CLOCK = `exports.up = async (knex) => {
  await knex.schema.createTable("presets", (table) => {
    table.increments("id");
    table.string("name");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("seen_at", { useTz: false }).defaultTo(knex.fn.now());
    table.date("day").defaultTo(knex.raw("CURRENT_DATE"));
    table.timestamp("noted_at", { useTz: true });
  });
  await knex("presets").insert({ name: "Core Coach", noted_at: new Date() });
};
exports.down = () => {};
`;
// A settings row a migration seeds with knex.fn.now() (SQL's CURRENT_TIMESTAMP) beside JavaScript's Date, as
// BeePollen's console_settings, allowed_login_email_settings and driers migrations do.
const SETTINGS = `exports.up = async (knex) => {
  await knex.schema.createTable("console_settings", (table) => {
    table.increments("id");
    table.string("name");
    table.timestamp("created_at", { useTz: true });
    table.timestamp("updated_at", { useTz: false });
  });
  await knex("console_settings").insert({ name: "default", created_at: knex.fn.now(), updated_at: new Date() });
};
exports.down = () => {};
`;
// A value computed from the clock, which no PostgreSQL build can freeze.
const TOMORROW = "exports.up = (knex) => knex(\"presets\").insert({ name: \"Tomorrow\", noted_at: knex.raw(\"now() + interval '1 day'\") });\n" +
  "exports.down = () => {};\n";

/**
 * An application in a directory of its own with `migrations`, whose TEST_DB_NAME is named after `suffix`; after the
 * test it and its snapshot database are dropped, with the directory.
 * @param {import("node:test").TestContext} context
 * @param {string} suffix
 * @param {Record<string, string>} migrations
 */
async function application(context, suffix, migrations) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), `jskit-migration-history-pg-${suffix}-`));
  await mkdir(path.join(appRoot, "migrations", "constraints"), { recursive: true });
  for (const [file, source] of Object.entries(migrations)) await writeFile(path.join(appRoot, "migrations", file), source);
  const name = `${TEST_DB_NAME}_${suffix}`;
  const environment = { ...process.env, DB_CLIENT: "pg", DB_NAME: TEST_DB_NAME, DATABASE_URL: "", TEST_DB_NAME: name };
  const knexConfig = createKnexMigrationConfig({ client: "pg", environment, appRoot });
  const on = (database) => knexFactory({ client: "pg", connection: { ...knexConfig.connection, database }, pool: { min: 0, max: 1 } });
  context.after(async () => {
    const admin = on(TEST_DB_NAME);
    try {
      for (const database of [name, `${name}_snapshot`]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    } finally {
      await admin.destroy();
      await rm(appRoot, { recursive: true, force: true });
    }
  });
  /** What `use` answers on `database`, connected only while it runs. */
  const read = async (database, use) => {
    const db = on(database);
    try {
      return await use(db);
    } finally {
      await db.destroy();
    }
  };
  const replays = async () => (await readFile(path.join(appRoot, "replays.log"), "utf8")).split("\n").filter(Boolean).length;
  return { appRoot, name, environment, knexConfig, read, replays };
}

test("on PostgreSQL the migration history proof replays every migration from empty into TEST_DB_NAME, finds nothing left for a second pass, matches the test snapshot, and leaves TEST_DB_NAME as the snapshot", {
  skip: SKIP
}, async (context) => {
  const { appRoot, name, environment, knexConfig, read, replays } = await application(context, "hist1", {
    "20200101000000_books.cjs": BOOKS
  });
  await prepareTestDatabases({ knexConfig, environment, appRoot });
  assert.equal(await replays(), 1, "the snapshot was built once");
  // A test file left a row and a table of its own in TEST_DB_NAME.
  await read(name, async (db) => {
    await db("books").insert({ title: "Left by a test" });
    await db.schema.createTable("scratch", (table) => table.increments("id"));
  });

  const proof = await proveMigrationHistory({ knexConfig, environment, appRoot });
  assert.match(proof.summary, new RegExp(`^1 migrations replayed from empty into ${name} in \\d+ms, nothing left for a ` +
    "second pass, the same tables, definitions and rows as the test snapshot \\(3 tables\\)$", "u"));
  assert.equal(await replays(), 2, "the proof replayed the history itself, from the stored snapshot's run");
  assert.deepEqual(await read(name, (db) => db("books").pluck("title")), ["Written by the migration"]);
  assert.equal(await read(name, (db) => db.schema.hasTable("scratch")), false);
});

test("on PostgreSQL a migration history that builds other rows, a column default, a constraint or an index on each replay fails the proof, naming each table, and leaves TEST_DB_NAME as the snapshot", {
  skip: SKIP
}, async (context) => {
  const { appRoot, name, environment, knexConfig, read } = await application(context, "hist2", {
    "20200101000000_books.cjs": BOOKS,
    "20200102000000_random.cjs": RANDOM
  });
  await prepareTestDatabases({ knexConfig, environment, appRoot });
  // The rows that differ are named, as read, and so is a table whose rows are the same.
  await assert.rejects(proveMigrationHistory({ knexConfig, environment, appRoot }), new RegExp(
    `^Error: The migration history proof: ${name}, built from empty, differs from the test snapshot in books, labels, ` +
    "limits, tags: books: 1 row\\(s\\) only in the replay \\(\\(2,[0-9a-f]{8}\\)\\) and 1 only in the snapshot \\(\\(2,[0-9a-f]{8}\\)\\); " +
    "labels: the same rows, another definition; limits: the same rows, another definition; and 1 more\\. ", "u"));
  const titles = (database) => read(database, (db) => db("books").orderBy("id").pluck("title"));
  assert.deepEqual(await titles(name), await titles(`${name}_snapshot`));
});

test("on PostgreSQL a migration history whose seed rows come from the clock (column defaults, knex.fn.now(), JavaScript's Date) passes the proof at another time, each build's clock values compared as its own", {
  skip: SKIP
}, async (context) => {
  const { appRoot, name, environment, knexConfig, read } = await application(context, "hist5", {
    "20200101000000_clock.cjs": CLOCK,
    "20200102000000_settings.cjs": SETTINGS
  });
  await prepareTestDatabases({ knexConfig, environment, appRoot });
  const preset = (database) => read(database, async (db) => (await db.raw("SELECT p::text AS row FROM presets p")).rows);
  const settings = (database) => read(database, async (db) => (await db.raw("SELECT s::text AS row FROM console_settings s")).rows);
  const built = await preset(name);
  const seeded = await settings(name);
  const proof = await proveMigrationHistory({ knexConfig, environment, appRoot });
  assert.match(proof.summary, /, the same tables, definitions and rows as the test snapshot \(4 tables\)$/u);
  assert.deepEqual(await preset(name), built);
  assert.deepEqual(await settings(name), seeded);
});

test("on PostgreSQL a value a migration computes from the clock fails the proof, naming its rows and why", { skip: SKIP }, async (context) => {
  const { appRoot, name, environment, knexConfig } = await application(context, "hist6", {
    "20200101000000_clock.cjs": CLOCK,
    "20200102000000_tomorrow.cjs": TOMORROW
  });
  await prepareTestDatabases({ knexConfig, environment, appRoot });
  await assert.rejects(proveMigrationHistory({ knexConfig, environment, appRoot }), new RegExp(
    `^Error: The migration history proof: ${name}, built from empty, differs from the test snapshot in presets: presets: ` +
    "1 row\\(s\\) only in the replay \\(\\(2,Tomorrow,[^)]*\\)\\) and 1 only in the snapshot \\(\\(2,Tomorrow,[^)]*\\)\\)\\. A migration " +
    "builds something else on each replay \\(.*PostgreSQL's clock cannot be frozen.*now\\(\\) \\+ interval", "u"));
});
