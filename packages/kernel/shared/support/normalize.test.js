import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOneOf,
  normalizeQueryToken
} from "./normalize.js";

test("normalizeQueryToken trims, lowercases, and falls back when empty", () => {
  assert.equal(normalizeQueryToken("  Admin  "), "admin");
  assert.equal(normalizeQueryToken(""), "__none__");
  assert.equal(normalizeQueryToken(null), "__none__");
  assert.equal(normalizeQueryToken("   ", { fallback: "surface" }), "surface");
});

test("normalizeOneOf returns normalized value when supported", () => {
  assert.equal(normalizeOneOf(" Compact ", ["compact", "comfortable"], "comfortable"), "compact");
});

test("normalizeOneOf returns fallback when value is unsupported", () => {
  assert.equal(normalizeOneOf("wide", ["compact", "comfortable"], "comfortable"), "comfortable");
});

test("normalizeOneOf falls back to first allowed value when fallback is empty", () => {
  assert.equal(normalizeOneOf("", ["compact", "comfortable"], ""), "compact");
});
