import assert from "node:assert/strict";
import test from "node:test";

import { createEntitlementMigrations, createEntitlementsKnexRepository, withTransaction } from "../src/index.js";

test("withTransaction uses knex.transaction when available", async () => {
  const calls = [];
  const knex = {
    async transaction(work) {
      calls.push("transaction");
      return work({ id: "trx-1" });
    }
  };

  const result = await withTransaction(knex, async (trx) => {
    calls.push(trx.id);
    return "ok";
  });

  assert.equal(result, "ok");
  assert.deepEqual(calls, ["transaction", "trx-1"]);
});

test("withTransaction falls back to callback when no transaction function exists", async () => {
  const client = { id: "plain-client" };
  const result = await withTransaction(client, async (trx) => {
    assert.equal(trx.id, "plain-client");
    return 42;
  });

  assert.equal(result, 42);
});

test("repository.transaction delegates to withTransaction", async () => {
  const knex = {
    client: {
      config: {
        client: "mysql2"
      }
    },
    async transaction(work) {
      return work({ id: "trx-repo" });
    }
  };

  const repository = createEntitlementsKnexRepository({ knex });
  const result = await repository.transaction(async (trx) => trx.id);
  assert.equal(result, "trx-repo");
});

test("createEntitlementMigrations renders SQL and runs up/down", async () => {
  const rawCalls = [];
  const droppedTables = [];

  const knex = {
    async raw(sql) {
      rawCalls.push(String(sql));
    },
    schema: {
      async dropTableIfExists(tableName) {
        droppedTables.push(tableName);
      }
    }
  };

  const migrations = createEntitlementMigrations({
    knex,
    tableNames: {
      entitlementDefinitions: "ent_defs",
      entitlementGrants: "ent_grants",
      entitlementConsumptions: "ent_consumptions",
      entitlementBalances: "ent_balances"
    }
  });

  assert.match(migrations.schemaSql, /ent_defs/);
  assert.match(migrations.indexesSql, /ent_balances/);

  await migrations.up();
  await migrations.down();

  assert.equal(rawCalls.length, 2);
  assert.deepEqual(droppedTables, ["ent_balances", "ent_consumptions", "ent_grants", "ent_defs"]);
});
