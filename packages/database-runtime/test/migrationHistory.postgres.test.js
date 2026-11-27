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
  await assert.rejects(proveMigrationHistory({ knexConfig, environment, appRoot }), new RegExp(
    `^Error: The migration history proof: ${name}, built from empty, differs from the test snapshot in books, labels, ` +
    "limits, tags: ", "u"));
  const titles = (database) => read(database, (db) => db("books").orderBy("id").pluck("title"));
  assert.deepEqual(await titles(name), await titles(`${name}_snapshot`));
});
