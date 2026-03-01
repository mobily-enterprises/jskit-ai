import assert from "node:assert/strict";
import test from "node:test";

import { normalizeNullablePositiveInteger, toPositiveInteger } from "../src/shared/integers.js";

test("toPositiveInteger returns parsed positive integers and fallback for invalid values", () => {
  assert.equal(toPositiveInteger(7), 7);
  assert.equal(toPositiveInteger("12"), 12);
  assert.equal(toPositiveInteger("0"), 0);
  assert.equal(toPositiveInteger(-5), 0);
  assert.equal(toPositiveInteger("invalid"), 0);
  assert.equal(toPositiveInteger("3", 99), 3);
  assert.equal(toPositiveInteger("invalid", 99), 99);
});

test("normalizeNullablePositiveInteger returns positive integers or null", () => {
  assert.equal(normalizeNullablePositiveInteger(9), 9);
  assert.equal(normalizeNullablePositiveInteger("11"), 11);
  assert.equal(normalizeNullablePositiveInteger(0), null);
  assert.equal(normalizeNullablePositiveInteger(""), null);
  assert.equal(normalizeNullablePositiveInteger("bad"), null);
});
