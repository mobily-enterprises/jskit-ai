import assert from "node:assert/strict";
import test from "node:test";
import { parsePositiveInteger } from "../src/shared/integers.js";

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
