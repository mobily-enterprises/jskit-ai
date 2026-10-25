import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDbRecordId,
  resolveInsertedRecordId
} from "../src/shared/repositoryOptions.js";

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
