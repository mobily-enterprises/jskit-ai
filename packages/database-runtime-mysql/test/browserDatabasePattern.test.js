import assert from "node:assert/strict";
import test from "node:test";
import knex from "knex";
import { prepareBrowserTestDatabase } from "../patterns/mysql-application/example/tests/browser/database.js";

const seed = async (db) => db("fixtures").insert({ id: 1, label: "baseline" });

test("browser preparation rejects missing, ordinary and production databases before connecting", async () => {
  const knexConfig = { client: "mysql2", connection: { database: "application" } };
  for (const environment of [
    {}, { TEST_DB_NAME: "application" }, { TEST_DB_NAME: "APPLICATION" },
    { TEST_DB_NAME: "other", DB_NAME: "other" },
    { TEST_DB_NAME: "other", DATABASE_URL: "mysql://localhost/other" },
    { TEST_DB_NAME: "tests", NODE_ENV: "production" }
  ]) {
    await assert.rejects(prepareBrowserTestDatabase({ knexConfig, environment, seed }), /TEST_DB_NAME|production/u);
  }
  await assert.rejects(prepareBrowserTestDatabase({ knexConfig, environment: { TEST_DB_NAME: "tests" } }), /seed/u);
});

test("native browser preparation retains schema, clears data and applies only new migrations", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async () => {
  const environment = process.env;
  const connection = { host: environment.DB_HOST, port: Number(environment.DB_PORT), user: environment.DB_USER,
    password: environment.DB_PASSWORD, database: environment.DB_NAME };
  const admin = knex({ client: "mysql2", connection: { ...connection, database: undefined } });
  const [[existing]] = await admin.raw("SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [environment.TEST_DB_NAME]);
  if (Number(existing.n)) {
    await admin.destroy();
    throw new Error("The native pattern regression requires a fresh, explicitly supplied TEST_DB_NAME.");
  }
  let db;
  let applied = 0;
  const migrations = [{ name: "001_fixture.js", async up(db) {
    applied += 1;
    await db.schema.createTable("fixtures", table => { table.increments("id"); table.string("label"); });
    await db.schema.createTable("children", table => { table.increments("id"); table.integer("parent_id").unsigned().references("fixtures.id"); });
  }, async down() {} }];
  const knexConfig = { client: "mysql2", connection, migrations: { migrationSource: {
    getMigrations: () => migrations, getMigrationName: migration => migration.name, getMigration: migration => migration
  } } };
  try {
    const [normalBefore] = await admin.raw("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [environment.DB_NAME]);
    const first = await prepareBrowserTestDatabase({ knexConfig, environment, seed });
    assert.deepEqual(first.migrations, ["001_fixture.js"]);
    db = knex({ client: "mysql2", connection: { ...connection, database: environment.TEST_DB_NAME } });
    const ledger = await db("knex_migrations").select();
    await db("fixtures").insert({ id: 2, label: "stale" });
    await db("children").insert({ parent_id: 2 });
    const second = await prepareBrowserTestDatabase({ knexConfig, environment, seed });
    assert.deepEqual(second.migrations, []);
    assert.equal(applied, 1);
    assert.deepEqual(await db("knex_migrations").select(), ledger);
    assert.deepEqual(await db("fixtures").select(), [{ id: 1, label: "baseline" }]);
    assert.deepEqual(await db("children").select(), []);
    // The preparation connection has foreign-key checks restored before seeding.
    await assert.rejects(prepareBrowserTestDatabase({ knexConfig, environment,
      seed: async db => db("children").insert({ parent_id: 99 }) }), /foreign key constraint/iu);
    migrations.push({ name: "002_pending.js", async up(db) {
      await db.schema.alterTable("fixtures", table => table.string("extra"));
    }, async down() {} });
    const third = await prepareBrowserTestDatabase({ knexConfig, environment, seed });
    assert.deepEqual(third.migrations, ["002_pending.js"]);
    assert.equal(await db.schema.hasColumn("fixtures", "extra"), true);
    assert.equal(applied, 1);
    const [normalAfter] = await admin.raw("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [environment.DB_NAME]);
    assert.deepEqual(normalAfter, normalBefore);
  } finally {
    await db?.destroy();
    await admin.raw("DROP DATABASE IF EXISTS ??", [environment.TEST_DB_NAME]);
    await admin.destroy();
  }
});
