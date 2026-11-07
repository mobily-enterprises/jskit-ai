import assert from "node:assert/strict";
import test from "node:test";
import createKnex from "knex";
import migration from "../migrations/auth_oidc_initial.cjs";
import { OIDC_CLIENT_INFRASTRUCTURE_TABLES } from "../src/server/lib/index.js";

test("OIDC_CLIENT_INFRASTRUCTURE_TABLES names every table the relying party's migration creates", async (t) => {
  const knex = createKnex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await migration.up(knex);
  const tables = await knex.raw("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  assert.deepEqual(tables.map(({ name }) => name).sort(), [...OIDC_CLIENT_INFRASTRUCTURE_TABLES].sort());
});
