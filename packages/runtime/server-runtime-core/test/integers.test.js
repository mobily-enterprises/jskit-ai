import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNullablePositiveInteger, parsePositiveInteger } from "../src/shared/integers.js";

test("parsePositiveInteger returns positive integers only", () => {
  assert.equal(parsePositiveInteger(1), 1);
  assert.equal(parsePositiveInteger("2"), 2);
});

test("parsePositiveInteger returns null for missing/invalid values", () => {
  assert.equal(parsePositiveInteger(null), null);
  assert.equal(parsePositiveInteger(undefined), null);
  assert.equal(parsePositiveInteger(""), null);
  assert.equal(parsePositiveInteger(0), null);
  assert.equal(parsePositiveInteger(-1), null);
  assert.equal(parsePositiveInteger(1.5), null);
  assert.equal(parsePositiveInteger("abc"), null);
});

test("normalizeNullablePositiveInteger matches parsePositiveInteger semantics", () => {
  assert.equal(normalizeNullablePositiveInteger(1), 1);
  assert.equal(normalizeNullablePositiveInteger("2"), 2);
  assert.equal(normalizeNullablePositiveInteger("abc"), null);
});
