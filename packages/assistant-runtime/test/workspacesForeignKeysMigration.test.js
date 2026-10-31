import assert from "node:assert/strict";
import test from "node:test";
import knex from "knex";
import configMigration from "../migrations/assistant_config_initial.cjs";
import transcriptsMigration from "../migrations/assistant_transcripts_initial.cjs";
import workspacesForeignKeysMigration from "../migrations/constraints/assistant_workspaces_foreign_keys.cjs";

const TABLES = ["assistant_config", "assistant_conversations", "assistant_messages"];

async function workspaceKeys(db) {
  const keys = [];
  for (const table of TABLES) {
    for (const key of await db.raw("PRAGMA foreign_key_list(??)", [table])) {
      if (key.table === "workspaces") keys.push({ table, from: key.from, on_delete: key.on_delete });
    }
  }
  return keys;
}

async function freshTables(t) {
  const db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => db.destroy());
  // Package table migrations run before workspaces-core's, so no workspaces table exists yet.
  await configMigration.up(db);
  await transcriptsMigration.up(db);
  assert.deepEqual(await workspaceKeys(db), []);
  return db;
}

test("the assistant tables get their workspaces keys in the constraints phase, once", async (t) => {
  const db = await freshTables(t);
  await db.schema.createTable("workspaces", (table) => table.bigInteger("id").primary());
  await workspacesForeignKeysMigration.up(db);
  const keys = TABLES.map((table) => ({ table, from: "workspace_id", on_delete: "CASCADE" }));
  assert.deepEqual(await workspaceKeys(db), keys);

  // Tables that already have their workspaces keys, as databases migrated before this phase do, are unchanged.
  await workspacesForeignKeysMigration.up(db);
  assert.deepEqual(await workspaceKeys(db), keys);

  await workspacesForeignKeysMigration.down(db);
  assert.deepEqual(await workspaceKeys(db), []);
});

test("an application without a workspaces table gets no workspaces keys", async (t) => {
  const db = await freshTables(t);
  await workspacesForeignKeysMigration.up(db);
  assert.deepEqual(await workspaceKeys(db), []);
});

test("rows whose workspace is gone stop the migration with their table, column and count, and stay", async (t) => {
  const db = await freshTables(t);
  await db.schema.createTable("workspaces", (table) => table.bigInteger("id").primary());
  await db("workspaces").insert({ id: 1 });
  await db("assistant_config").insert([
    { target_surface_id: "app", scope_key: "workspace:1", workspace_id: 1 },
    { target_surface_id: "app", scope_key: "workspace:7", workspace_id: 7 },
    { target_surface_id: "app", scope_key: "workspace:8", workspace_id: 8 }
  ]);
  await assert.rejects(
    workspacesForeignKeysMigration.up(db),
    /assistant_config\.workspace_id foreign key to workspaces\.id: 2 assistant_config row\(s\) have a workspace_id with no workspaces row/u
  );
  assert.equal((await db("assistant_config")).length, 3);
  assert.deepEqual(await workspaceKeys(db), []);
});
