import test from "node:test";
import assert from "node:assert/strict";
import {
  isDeadlockError,
  normalizeDbRecordId,
  parseJsonValue,
  resolveInsertedRecordId,
  retryDeadlocks
} from "../src/shared/repositoryOptions.js";

function deadlock() {
  return Object.assign(new Error("Deadlock found when trying to get lock; try restarting transaction"), {
    code: "ER_LOCK_DEADLOCK",
    errno: 1213
  });
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

test("isDeadlockError recognizes deadlock victims through causes, never a committed write", () => {
  assert.equal(isDeadlockError(deadlock()), true);
  assert.equal(isDeadlockError({ errno: 1213 }), true);
  assert.equal(isDeadlockError({ code: "40P01" }), true);
  assert.equal(isDeadlockError({ code: "SQLITE_BUSY", transactionOutcome: "rolledBack" }), true);
  // MariaDB's snapshot isolation: a locking read of a row changed since the transaction's snapshot.
  assert.equal(isDeadlockError({ code: "ER_CHECKREAD", errno: 1020 }), true);
  assert.equal(isDeadlockError({ errno: 1020 }), true);
  assert.equal(isDeadlockError(new Error("Write failed", { cause: { code: "ER_CHECKREAD", errno: 1020 } })), true);
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

test("retryDeadlocks runs again a transaction that read a row changed since its snapshot", async () => {
  let attempts = 0;
  const result = await retryDeadlocks(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("Write failed", { cause: Object.assign(new Error("Record has changed since last read"), { code: "ER_CHECKREAD", errno: 1020 }) });
    }
    return "clean";
  });
  assert.deepEqual([result, attempts], ["clean", 2]);
});

test("retryDeadlocks runs a deadlock victim again and returns the clean run", async () => {
  let attempts = 0;
  const result = await retryDeadlocks(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw deadlock();
    }
    return "clean";
  });
  assert.equal(result, "clean");
  assert.equal(attempts, 3);
});

test("retryDeadlocks runs again only deadlock victims, a few times", async () => {
  async function attemptsUntilRejected(error, options) {
    let attempts = 0;
    await assert.rejects(retryDeadlocks(async () => {
      attempts += 1;
      throw error;
    }, options), error);
    return attempts;
  }
  assert.equal(await attemptsUntilRejected(new Error("Validation failed")), 1);
  // A lock wait that timed out is not a deadlock: the database may have rolled back only the statement, so the
  // transaction's earlier work could run twice. MySQL and MariaDB, then PostgreSQL's lock_timeout and NOWAIT.
  for (const timeout of [
    Object.assign(new Error("Lock wait timeout exceeded"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 }),
    Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" }),
    new Error("Write failed", { cause: Object.assign(new Error("Lock wait timeout exceeded"), { errno: 1205 }) })
  ]) {
    assert.equal(isDeadlockError(timeout), false, timeout.message);
    assert.equal(await attemptsUntilRejected(timeout), 1, timeout.message);
  }
  const victim = deadlock();
  assert.equal(await attemptsUntilRejected(victim), 4);
  assert.equal(await attemptsUntilRejected(victim, { retries: 0 }), 1);
});
