import test from "node:test";
import assert from "node:assert/strict";
import {
  isDeadlockError,
  lockScopedRecordId,
  normalizeDbRecordId,
  parseJsonValue,
  resolveInsertedRecordId,
  runInTransaction
} from "../src/shared/repositoryOptions.js";

function deadlock() {
  return Object.assign(new Error("Deadlock found when trying to get lock; try restarting transaction"), {
    code: "ER_LOCK_DEADLOCK",
    errno: 1213
  });
}

function fakeKnex({ isTransaction = false } = {}) {
  return Object.assign(() => {}, { isTransaction, transaction: async (callback) => callback("trx") });
}

function fakeLockTransaction(row = null) {
  const calls = [];
  const query = {
    select(value) { calls.push(["select", value]); return this; },
    where(key, value) { calls.push(["where", key, value]); return this; },
    andWhere(key, value) { calls.push(["andWhere", key, value]); return this; },
    forUpdate() { calls.push(["forUpdate"]); return this; },
    async first() { calls.push(["first"]); return row; }
  };
  const trx = (table) => {
    calls.push(["table", table]);
    return query;
  };
  return { calls, trx };
}

test("normalizeDbRecordId preserves canonical DB ids and rejects unsafe JS numbers", () => {
  const unsafeNumericId = Number(9007199254740993n);
  assert.equal(normalizeDbRecordId("9007199254740993"), "9007199254740993");
  assert.equal(normalizeDbRecordId(42), "42");
  assert.equal(normalizeDbRecordId(42n), "42");
  assert.equal(normalizeDbRecordId(unsafeNumericId), null);
});

test("resolveInsertedRecordId normalizes insert ids without accepting unsafe JS numbers", () => {
  const unsafeNumericId = Number(9007199254740993n);
  assert.equal(resolveInsertedRecordId(["9007199254740993"]), "9007199254740993");
  assert.equal(resolveInsertedRecordId([42]), "42");
  assert.equal(resolveInsertedRecordId([unsafeNumericId]), null);
});

test("parseJsonValue parses stored JSON and falls back for empty, null or invalid text", () => {
  assert.deepEqual(parseJsonValue(" [1,2] "), [1, 2]);
  assert.deepEqual(parseJsonValue({ source: "console" }), { source: "console" });
  assert.equal(parseJsonValue("", "fallback"), "fallback");
  assert.equal(parseJsonValue("{", "fallback"), "fallback");
  assert.equal(parseJsonValue("null", "fallback"), "fallback");
  assert.equal(parseJsonValue("null", "fallback", { allowNull: true }), null);
  assert.deepEqual(parseJsonValue(undefined, null, { fallback: [] }), []);
});

test("lockScopedRecordId locks an exact record inside its owner scope", async () => {
  const { calls, trx } = fakeLockTransaction({ id: "42" });
  assert.equal(await lockScopedRecordId({
    trx,
    tableName: "daycare_events",
    recordId: 42,
    scopeId: 7
  }), "42");
  assert.deepEqual(calls, [
    ["table", "daycare_events"],
    ["select", "id"],
    ["where", "id", "42"],
    ["andWhere", "workspace_id", "7"],
    ["forUpdate"],
    ["first"]
  ]);
});

test("lockScopedRecordId rejects missing transactions and unsafe identifiers", async () => {
  await assert.rejects(
    () => lockScopedRecordId({ tableName: "records", recordId: 1, scopeId: 1 }),
    /requires a transaction/u
  );
  const { trx } = fakeLockTransaction();
  await assert.rejects(
    () => lockScopedRecordId({ trx, tableName: "records; drop table", recordId: 1, scopeId: 1 }),
    /safe SQL identifier/u
  );
});

test("isDeadlockError recognizes deadlock victims through causes, never a committed write", () => {
  assert.equal(isDeadlockError(deadlock()), true);
  assert.equal(isDeadlockError({ errno: 1213 }), true);
  assert.equal(isDeadlockError({ code: "40P01" }), true);
  assert.equal(isDeadlockError(new Error("Write failed", { cause: deadlock() })), true);
  assert.equal(isDeadlockError({ code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 }), false);
  assert.equal(isDeadlockError({ code: "ER_DUP_ENTRY", errno: 1062 }), false);
  assert.equal(isDeadlockError({ transactionOutcome: "committed", cause: deadlock() }), false);
  const cyclic = new Error("cyclic");
  cyclic.cause = cyclic;
  for (const error of [null, undefined, "deadlock", cyclic]) {
    assert.equal(isDeadlockError(error), false);
  }
});

test("runInTransaction runs a deadlock victim again and returns the clean run", async () => {
  let attempts = 0;
  const result = await runInTransaction(fakeKnex(), async (trx) => {
    attempts += 1;
    if (attempts < 3) {
      throw deadlock();
    }
    return trx;
  });
  assert.equal(result, "trx");
  assert.equal(attempts, 3);
});

test("runInTransaction retries only deadlocks of the outermost transaction, a few times", async () => {
  async function attemptsUntilRejected(knex, error, options) {
    let attempts = 0;
    await assert.rejects(runInTransaction(knex, async () => {
      attempts += 1;
      throw error;
    }, options), error);
    return attempts;
  }
  const failure = new Error("Validation failed");
  assert.equal(await attemptsUntilRejected(fakeKnex(), failure), 1);
  const victim = deadlock();
  assert.equal(await attemptsUntilRejected(fakeKnex(), victim), 4);
  assert.equal(await attemptsUntilRejected(fakeKnex(), victim, { retries: 0 }), 1);
  assert.equal(await attemptsUntilRejected(fakeKnex({ isTransaction: true }), victim), 1, "A savepoint leaves the retry to its outermost transaction");
});
