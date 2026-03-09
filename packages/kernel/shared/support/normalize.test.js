import test from "node:test";
import assert from "node:assert/strict";
import { normalizeQueryToken } from "./normalize.js";

test("normalizeQueryToken trims, lowercases, and falls back when empty", () => {
  assert.equal(normalizeQueryToken("  Admin  "), "admin");
  assert.equal(normalizeQueryToken(""), "__none__");
  assert.equal(normalizeQueryToken(null), "__none__");
  assert.equal(normalizeQueryToken("   ", { fallback: "surface" }), "surface");
});
