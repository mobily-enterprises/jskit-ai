import assert from "node:assert/strict";
import test from "node:test";
import knexFactory from "knex";
import {
  addMissingForeignKey,
  dropForeignKeyIfPresent,
  hasForeignKey
} from "../src/server/foreignKeyMigrations.js";

const KEY = { tableName: "children", columnName: "parent_id", parentTable: "parents", onDelete: "SET NULL" };

async function keyCount(knex) {
  return (await knex.raw("PRAGMA foreign_key_list(children)")).length;
}

test("addMissingForeignKey adds a missing key once, refuses rows without a parent and deletes nothing", async (t) => {
  const knex = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("parents", (table) => table.integer("id").primary());
  await knex.schema.createTable("children", (table) => {
    table.increments("id");
    table.integer("parent_id").nullable();
  });
  await knex("parents").insert({ id: 1 });
  await knex("children").insert([{ parent_id: 1 }, { parent_id: null }]);

  assert.equal(await addMissingForeignKey(knex, KEY), true);
  assert.equal(await hasForeignKey(knex, KEY), true);
  assert.equal(await addMissingForeignKey(knex, KEY), false);
  assert.equal(await keyCount(knex), 1);

  assert.equal(await dropForeignKeyIfPresent(knex, KEY), true);
  assert.equal(await dropForeignKeyIfPresent(knex, KEY), false);
  assert.equal(await keyCount(knex), 0);

  await knex("children").insert({ parent_id: 9 });
  await assert.rejects(
    addMissingForeignKey(knex, KEY),
    /children\.parent_id foreign key to parents\.id: 1 children row\(s\) have a parent_id with no parents row/u
  );
  assert.equal((await knex("children")).length, 3);
  assert.equal(await keyCount(knex), 0);

  await assert.rejects(
    addMissingForeignKey(knex, { ...KEY, parentTable: "guardians" }),
    /children\.parent_id foreign key: the guardians table does not exist/u
  );
});
