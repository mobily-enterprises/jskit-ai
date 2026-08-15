import assert from "node:assert/strict";
import test from "node:test";

import {
  BaseRepository,
  buildPaginationMeta,
  createTransactionManager,
  createWithTransaction
} from "../src/shared/index.js";

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

test("base repository withTransaction delegates to transaction manager", async () => {
  const knex = createKnexStub();
  const transactionManager = createTransactionManager({ knex });
  const repo = new BaseRepository({ knex, transactionManager });

  const result = await repo.withTransaction(async (trx) => ({ id: trx.trxId }));
  assert.deepEqual(result, { id: "trx-1" });
});

test("createWithTransaction creates a reusable withTransaction function", async () => {
  const knex = Object.assign(() => {
    throw new Error("query execution not expected");
  }, createKnexStub());
  const withTransaction = createWithTransaction(knex);
  const result = await withTransaction(async (trx) => ({ id: trx.trxId }));
  assert.deepEqual(result, { id: "trx-1" });
});

test("pagination helpers generate stable metadata", () => {
  const meta = buildPaginationMeta({ total: 51, page: 2, pageSize: 25 });
  assert.deepEqual(meta, {
    total: 51,
    page: 2,
    pageSize: 25,
    pageCount: 3,
    hasPrev: true,
    hasNext: true
  });
});
