import assert from "node:assert/strict";
import test from "node:test";
import knex from "knex";
import {
  addMissingForeignKey,
  dropForeignKeyIfPresent,
  hasForeignKey
} from "@jskit-ai/database-runtime/server/foreignKeyMigrations";

const KEY = { tableName: "children", columnName: "parent_id", parentTable: "parents" };

test("dropForeignKeyIfPresent drops a MySQL key by the name the database holds", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async () => {
  const environment = process.env;
  const databaseName = `${environment.TEST_DB_NAME}_fk`;
  const connection = { host: environment.DB_HOST, port: Number(environment.DB_PORT), user: environment.DB_USER,
    password: environment.DB_PASSWORD };
  const admin = knex({ client: "mysql2", connection });
  let db = null;
  try {
    await admin.raw("DROP DATABASE IF EXISTS ??", [databaseName]);
    await admin.raw("CREATE DATABASE ??", [databaseName]);
    db = knex({ client: "mysql2", connection: { ...connection, database: databaseName } });
    await db.schema.createTable("parents", (table) => table.increments("id"));
    await db.schema.createTable("children", (table) => {
      table.increments("id");
      table.integer("parent_id").unsigned().nullable();
      table.foreign("parent_id", "children_parent_custom_fk").references("id").inTable("parents");
    });

    assert.equal(await hasForeignKey(db, KEY), true);
    assert.equal(await addMissingForeignKey(db, KEY), false);
    assert.equal(await dropForeignKeyIfPresent(db, KEY), true);
    assert.equal(await hasForeignKey(db, KEY), false);
    assert.equal(await dropForeignKeyIfPresent(db, KEY), false);
  } finally {
    await db?.destroy();
    await admin.raw("DROP DATABASE IF EXISTS ??", [databaseName]);
    await admin.destroy();
  }
});
