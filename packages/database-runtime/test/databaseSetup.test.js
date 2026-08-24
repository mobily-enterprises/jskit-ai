import assert from "node:assert/strict";
import test from "node:test";
import { runDatabaseSetup } from "../src/server/databaseSetup.js";

function fakeKnex({ migrationResult = [3, ["users.cjs"]] } = {}) {
  const calls = [];
  const transaction = Object.freeze({ id: "transaction" });
  const knex = function knex() {};
  knex.migrate = {
    async latest() {
      calls.push("migrate");
      return migrationResult;
    }
  };
  knex.transaction = async (callback) => {
    calls.push("transaction:start");
    await callback(transaction);
    calls.push("transaction:commit");
  };
  return { calls, knex, transaction };
}

test("runDatabaseSetup migrates before one explicit app seed transaction", async () => {
  const { calls, knex, transaction } = fakeKnex();
  const environment = { DB_NAME: "session_database" };

  const result = await runDatabaseSetup({
    knex,
    appRoot: "/srv/session/source",
    environment,
    async seed(context) {
      calls.push("seed");
      assert.equal(context.knex, transaction);
      assert.equal(context.appRoot, "/srv/session/source");
      assert.equal(context.environment, environment);
    }
  });

  assert.deepEqual(calls, ["migrate", "transaction:start", "seed", "transaction:commit"]);
  assert.deepEqual(result, {
    batch: 3,
    migrations: ["users.cjs"],
    seeded: true
  });
});

test("runDatabaseSetup supports applications with no seed operation", async () => {
  const { calls, knex } = fakeKnex({ migrationResult: [0, []] });

  assert.deepEqual(await runDatabaseSetup({ knex }), {
    batch: 0,
    migrations: [],
    seeded: false
  });
  assert.deepEqual(calls, ["migrate"]);
});

test("runDatabaseSetup rejects a non-function seed", async () => {
  const { knex } = fakeKnex();
  await assert.rejects(
    () => runDatabaseSetup({ knex, seed: "seed" }),
    /seed must be a function/u
  );
});
