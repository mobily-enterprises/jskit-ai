import test from "node:test";
import assert from "node:assert/strict";
import {
  lockScopedRecordId,
  normalizeDbRecordId,
  parseJsonValue,
  resolveInsertedRecordId
} from "../src/shared/repositoryOptions.js";

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
