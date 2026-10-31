import assert from "node:assert/strict";
import test from "node:test";
import knex from "knex";
import initialMigration from "../migrations/console_core_generic_initial.cjs";
import usersForeignKeyMigration from "../migrations/constraints/console_core_users_foreign_key.cjs";

async function usersKeys(db) {
  return (await db.raw("PRAGMA foreign_key_list(console_settings)"))
    .filter((key) => key.table === "users")
    .map(({ from, to, on_delete: onDelete }) => ({ from, to, onDelete }));
}

test("console_settings is created before users exists and gets its users key in the constraints phase", async (t) => {
  const db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => db.destroy());

  // console-core's table migrations run before users-core's and before the application's.
  await initialMigration.up(db);
  assert.deepEqual(await usersKeys(db), []);

  await assert.rejects(usersForeignKeyMigration.up(db), /the users table does not exist/u);
  await db.schema.createTable("users", (table) => table.bigInteger("id").primary());
  await usersForeignKeyMigration.up(db);
  const key = [{ from: "owner_user_id", to: "id", onDelete: "SET NULL" }];
  assert.deepEqual(await usersKeys(db), key);
  assert.equal((await db("console_settings")).length, 1);

  // A table that already has its users key, as databases migrated before this phase do, gains no duplicate.
  await usersForeignKeyMigration.up(db);
  assert.deepEqual(await usersKeys(db), key);

  await usersForeignKeyMigration.down(db);
  assert.deepEqual(await usersKeys(db), []);
});
