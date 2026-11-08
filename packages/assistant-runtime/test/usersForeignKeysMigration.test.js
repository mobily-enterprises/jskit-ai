import assert from "node:assert/strict";
import test from "node:test";
import knex from "knex";
import configMigration from "../migrations/assistant_config_initial.cjs";
import transcriptsMigration from "../migrations/assistant_transcripts_initial.cjs";
import turnRequestsMigration from "../migrations/assistant_turn_requests.cjs";
import usersForeignKeysMigration from "../migrations/constraints/assistant_users_foreign_keys.cjs";
import workspacesForeignKeysMigration from "../migrations/constraints/assistant_workspaces_foreign_keys.cjs";
import { checkForeignKeys } from "@jskit-ai/resource-runtime/server";
import * as assistantResources from "../src/server/repositories/assistantResources.js";

const USER_KEYS = [
  { table: "assistant_conversations", from: "created_by_user_id", on_delete: "SET NULL" },
  { table: "assistant_messages", from: "actor_user_id", on_delete: "SET NULL" },
  { table: "assistant_turn_requests", from: "actor_user_id", on_delete: "CASCADE" }
];

async function usersKeys(db) {
  const keys = [];
  for (const { table } of USER_KEYS) {
    for (const key of await db.raw("PRAGMA foreign_key_list(??)", [table])) {
      if (key.table === "users") keys.push({ table, from: key.from, on_delete: key.on_delete });
    }
  }
  return keys;
}

test("the assistant tables are created before users exists and get their users keys in the constraints phase", async (t) => {
  const db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => db.destroy());

  // Package table migrations run before the application's migrations, which may create users.
  await configMigration.up(db);
  await transcriptsMigration.up(db);
  await turnRequestsMigration.up(db);
  assert.deepEqual(await usersKeys(db), []);

  await assert.rejects(usersForeignKeysMigration.up(db), /the users table does not exist/u);
  await db.schema.createTable("users", (table) => table.bigInteger("id").primary());
  await usersForeignKeysMigration.up(db);
  assert.deepEqual(await usersKeys(db), USER_KEYS);

  // Tables that already have their users keys, as databases migrated before this phase do, gain no duplicate.
  await usersForeignKeysMigration.up(db);
  assert.deepEqual(await usersKeys(db), USER_KEYS);

  await usersForeignKeysMigration.down(db);
  assert.deepEqual(await usersKeys(db), []);
});

test("the assistant table resources declare the foreign keys their migrations always create", async (t) => {
  const db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => db.destroy());
  const resources = Object.values(assistantResources);
  const tables = resources.map((resource) => resource.tableName);
  for (const migration of [configMigration, transcriptsMigration, turnRequestsMigration]) await migration.up(db);
  await db.schema.createTable("users", (table) => table.bigInteger("id").primary());
  await usersForeignKeysMigration.up(db);
  assert.deepEqual(await checkForeignKeys({ knex: db, resources, tables }), { missing: [], undeclared: [] });

  // An application with workspaces also gets the workspace_id keys, which no resource declares: not every
  // application has them.
  await db.schema.createTable("workspaces", (table) => table.bigInteger("id").primary());
  await workspacesForeignKeysMigration.up(db);
  const { missing, undeclared } = await checkForeignKeys({ knex: db, resources, tables });
  assert.deepEqual(missing, []);
  assert.deepEqual(undeclared.map(({ tableName, columns, referencedTableName }) => ({ tableName, columns, referencedTableName })),
    ["assistant_config", "assistant_conversations", "assistant_messages"]
      .map((tableName) => ({ tableName, columns: ["workspace_id"], referencedTableName: "workspaces" })));
});
