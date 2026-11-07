import assert from "node:assert/strict";
import test from "node:test";

import { createTransactionManager } from "../src/shared/transactionManager.js";

function createKnexStub() {
  return {
    async transaction(callback) {
      return callback({ trxId: "trx-1" });
    }
  };
}

test("transaction manager wraps callback in knex transaction", async () => {
  const manager = createTransactionManager({ knex: createKnexStub() });
  const result = await manager.inTransaction(async (trx) => ({ ok: true, trx }));
  assert.equal(result.ok, true);
  assert.equal(result.trx.trxId, "trx-1");
});

test("transaction manager runs a deadlocked transaction again but never a borrowed one", async () => {
  const manager = createTransactionManager({ knex: createKnexStub() });
  const deadlock = Object.assign(new Error("Deadlock found when trying to get lock"), { code: "ER_LOCK_DEADLOCK" });
  let attempts = 0;
  const result = await manager.inTransaction(async (trx) => {
    attempts += 1;
    if (attempts === 1) {
      throw deadlock;
    }
    return trx.trxId;
  });
  assert.equal(result, "trx-1");
  assert.equal(attempts, 2);

  attempts = 0;
  await assert.rejects(manager.inTransaction(async () => {
    attempts += 1;
    throw deadlock;
  }, { trx: { trxId: "outer" } }), deadlock);
  assert.equal(attempts, 1);
});
