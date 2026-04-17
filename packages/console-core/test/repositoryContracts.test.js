import assert from "node:assert/strict";
import test from "node:test";
import { createRepository as createConsoleSettingsRepository } from "../src/server/consoleSettings/consoleSettingsRepository.js";

function createKnexStub() {
  const knex = Object.assign(() => {
    throw new Error("query execution not expected");
  }, {
    async transaction(work) {
      return work({ trxId: "trx-1" });
    }
  });

  return knex;
}

test("console-core repositories expose withTransaction", async () => {
  const knex = createKnexStub();
  const repositories = [
    createConsoleSettingsRepository(knex)
  ];

  for (const repository of repositories) {
    assert.equal(typeof repository.withTransaction, "function");
    const result = await repository.withTransaction(async (trx) => ({ id: trx.trxId }));
    assert.deepEqual(result, { id: "trx-1" });
  }
});
