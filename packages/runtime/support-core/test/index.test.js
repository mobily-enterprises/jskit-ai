import assert from "node:assert/strict";
import test from "node:test";
import {
  TOKENS,
  ensureNonEmptyText,
  normalizeArray,
  normalizeInteger,
  normalizeObject,
  normalizeText,
  sortById,
  sortStrings
} from "../src/shared/index.js";

test("tokens are stable symbols", () => {
  assert.equal(typeof TOKENS.Logger, "symbol");
  assert.equal(TOKENS.Logger, Symbol.for("jskit.logger"));
});

test("normalize helpers return safe values", () => {
  assert.equal(normalizeText("  x  "), "x");
  assert.equal(normalizeText(null, { fallback: "n/a" }), "n/a");
  assert.deepEqual(normalizeObject(null), {});
  assert.deepEqual(normalizeArray(null), []);
  assert.equal(normalizeInteger("3.9"), 3);
  assert.equal(normalizeInteger("-20", { min: 0 }), 0);
  assert.equal(normalizeInteger("999", { max: 10 }), 10);
  assert.throws(() => ensureNonEmptyText("   ", "id"), /id is required/);
});

test("sorting helpers are deterministic", () => {
  assert.deepEqual(sortStrings(["beta", "alpha", "beta", "  "]), ["alpha", "beta"]);
  assert.deepEqual(sortById([{ id: "b" }, { id: "a" }]).map((item) => item.id), ["a", "b"]);
});
