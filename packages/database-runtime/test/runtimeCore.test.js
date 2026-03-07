import assert from "node:assert/strict";
import test from "node:test";

import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  BaseRepository,
  buildPaginationMeta,
  createTransactionManager,
  registerDatabaseRuntime
} from "../src/shared/index.js";

function createKnexStub() {
  return {
    async transaction(callback) {
      return callback({ trxId: "trx-1" });
    }
  };
}

function createSingletonApp() {
  const singletons = new Map();
  const instances = new Map();

  return {
    has(token) {
      return singletons.has(token) || instances.has(token);
    },
    instance(token, value) {
      if (this.has(token)) {
        throw new Error(`Token ${String(token)} is already registered.`);
      }
      instances.set(token, value);
    },
    singleton(token, factory) {
      if (this.has(token)) {
        throw new Error(`Token ${String(token)} is already registered.`);
      }
      singletons.set(token, {
        factory,
        resolved: false,
        value: undefined
      });
    },
    make(token) {
      if (instances.has(token)) {
        return instances.get(token);
      }
      if (!singletons.has(token)) {
        throw new Error(`Token ${String(token)} is not registered.`);
      }
      const entry = singletons.get(token);
      if (!entry.resolved) {
        entry.value = entry.factory(this);
        entry.resolved = true;
        instances.set(token, entry.value);
      }
      return entry.value;
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

test("registerDatabaseRuntime binds knex and transaction manager tokens", () => {
  const app = createSingletonApp();
  const knex = createKnexStub();

  const runtime = registerDatabaseRuntime(app, { knex });
  assert.strictEqual(runtime.knex, knex);
  assert.equal(typeof runtime.transactionManager.inTransaction, "function");
  assert.strictEqual(app.make(KERNEL_TOKENS.Knex), knex);
});
