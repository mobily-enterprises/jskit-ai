import assert from "node:assert/strict";
import test from "node:test";
import { createRepository as createConsoleSettingsRepository } from "../src/server/consoleSettings/consoleSettingsRepository.js";

// A console settings handle whose transaction hands its work the options with the transaction.
function createHandleStub() {
  return {
    async withTransaction(options, work) {
      return work({ ...options, trx: { trxId: "trx-1" } });
    }
  };
}

test("console-core repositories expose withTransaction", async () => {
  const repositories = [
    createConsoleSettingsRepository({ consoleSettings: createHandleStub() })
  ];

  for (const repository of repositories) {
    assert.equal(typeof repository.withTransaction, "function");
    const result = await repository.withTransaction({}, async (txOptions) => ({ id: txOptions.trx.trxId }));
    assert.deepEqual(result, { id: "trx-1" });
  }
});
