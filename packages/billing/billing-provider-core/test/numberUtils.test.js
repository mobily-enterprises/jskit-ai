import assert from "node:assert/strict";
import test from "node:test";

import { parsePositiveInteger } from "../src/shared/numberUtils.js";

test("parsePositiveInteger returns parsed positive integers", () => {
  assert.equal(parsePositiveInteger("2", 1), 2);
  assert.equal(parsePositiveInteger(10, 1), 10);
});

test("parsePositiveInteger returns fallback when value is invalid", () => {
  assert.equal(parsePositiveInteger("foo", 3), 3);
  assert.equal(parsePositiveInteger(0, 3), 3);
  assert.equal(parsePositiveInteger(-2, 3), 3);
  assert.equal(parsePositiveInteger(null, 3), 3);
});
