import assert from "node:assert/strict";
import test from "node:test";
import providerConfigsMigration from "../migrations/rewarded_provider_configs_initial.cjs";
import rulesMigration from "../migrations/rewarded_rules_initial.cjs";
import unlockReceiptsMigration from "../migrations/rewarded_unlock_receipts_initial.cjs";
import watchSessionsMigration from "../migrations/rewarded_watch_sessions_initial.cjs";
import foreignKeysMigration from "../migrations/constraints/rewarded_foreign_keys.cjs";
import { openOwnDatabase } from "./mysqlDatabase.js";

// Knex's filename order within rewarded-core's migrations/ directory.
const TABLE_MIGRATIONS = [providerConfigsMigration, rulesMigration, unlockReceiptsMigration, watchSessionsMigration];
const TABLES = ["rewarded_provider_configs", "rewarded_rules", "rewarded_unlock_receipts", "rewarded_watch_sessions"];
const databaseUrl = process.env.REWARDED_TEST_DATABASE_URL;

async function foreignKeys(knex) {
  return knex("information_schema.REFERENTIAL_CONSTRAINTS")
    .whereRaw("CONSTRAINT_SCHEMA = DATABASE()")
    .whereIn("TABLE_NAME", TABLES)
    .orderBy(["TABLE_NAME", "CONSTRAINT_NAME"])
    .select({ name: "CONSTRAINT_NAME", parent: "REFERENCED_TABLE_NAME", onDelete: "DELETE_RULE", onUpdate: "UPDATE_RULE" });
}

const PROVIDER_KEYS = [
  { name: "fk_rewarded_unlock_receipts_provider_config", parent: "rewarded_provider_configs", onDelete: "SET NULL", onUpdate: "RESTRICT" },
  { name: "fk_rewarded_watch_sessions_provider_config", parent: "rewarded_provider_configs", onDelete: "SET NULL", onUpdate: "RESTRICT" }
];
const ALL_KEYS = [
  { name: "fk_rewarded_provider_configs_workspace", parent: "workspaces", onDelete: "CASCADE", onUpdate: "RESTRICT" },
  { name: "fk_rewarded_rules_workspace", parent: "workspaces", onDelete: "CASCADE", onUpdate: "RESTRICT" },
  PROVIDER_KEYS[0],
  { name: "fk_rewarded_unlock_receipts_user", parent: "users", onDelete: "CASCADE", onUpdate: "RESTRICT" },
  { name: "fk_rewarded_unlock_receipts_watch_session", parent: "rewarded_watch_sessions", onDelete: "SET NULL", onUpdate: "RESTRICT" },
  { name: "fk_rewarded_unlock_receipts_workspace", parent: "workspaces", onDelete: "CASCADE", onUpdate: "RESTRICT" },
  PROVIDER_KEYS[1],
  { name: "fk_rewarded_watch_sessions_user", parent: "users", onDelete: "CASCADE", onUpdate: "RESTRICT" },
  { name: "fk_rewarded_watch_sessions_workspace", parent: "workspaces", onDelete: "CASCADE", onUpdate: "RESTRICT" }
];

test("a fresh MySQL database migrates rewarded-core before users and workspaces exist, then adds its keys", {
  skip: databaseUrl ? false : "REWARDED_TEST_DATABASE_URL (MySQL) is required: the shipped migrations use MySQL defaults."
}, async (t) => {
  const { knex, dropDatabase } = await openOwnDatabase(databaseUrl, "keys");
  let ownsTables = false;
  t.after(async () => {
    try {
      if (ownsTables) {
        await foreignKeysMigration.down(knex);
        for (const migration of [...TABLE_MIGRATIONS].reverse()) await migration.down(knex);
        await knex.schema.dropTableIfExists("users");
        await knex.schema.dropTableIfExists("workspaces");
      }
    } finally {
      await knex.destroy();
      await dropDatabase();
    }
  });
  for (const table of [...TABLES, "users", "workspaces"]) {
    assert.equal(await knex.schema.hasTable(table), false, `Refuse to reuse existing ${table}.`);
  }
  ownsTables = true;

  // rewarded-core's table migrations run before users-core and workspaces-core create their tables.
  for (const migration of TABLE_MIGRATIONS) await migration.up(knex);
  assert.deepEqual(await foreignKeys(knex), PROVIDER_KEYS);

  for (const table of ["users", "workspaces"]) {
    await knex.schema.createTable(table, (builder) => builder.bigInteger("id").unsigned().primary());
  }
  await foreignKeysMigration.up(knex);
  assert.deepEqual(await foreignKeys(knex), ALL_KEYS);

  // Keys that already exist are left as they are.
  await foreignKeysMigration.up(knex);
  assert.deepEqual(await foreignKeys(knex), ALL_KEYS);

  // A database missing a key whose rows have no parent fails clearly and keeps its rows.
  await knex.schema.alterTable("rewarded_watch_sessions", (table) => table.dropForeign("user_id", "fk_rewarded_watch_sessions_user"));
  await knex("workspaces").insert({ id: 1 });
  await knex("rewarded_watch_sessions").insert({ workspace_id: 1, user_id: 999, gate_key: "progress" });
  await assert.rejects(
    foreignKeysMigration.up(knex),
    /rewarded_watch_sessions\.user_id foreign key to users\.id: 1 rewarded_watch_sessions row\(s\) have a user_id with no users row/u
  );
  assert.equal((await knex("rewarded_watch_sessions")).length, 1);
  assert.deepEqual(await foreignKeys(knex), ALL_KEYS.filter((key) => key.name !== "fk_rewarded_watch_sessions_user"));
  await knex("rewarded_watch_sessions").delete();
});
