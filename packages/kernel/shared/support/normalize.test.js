import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOpaqueId,
  normalizePositiveInteger,
  normalizeOneOf,
  normalizeQueryToken,
  normalizeUniqueTextList
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

test("normalizePositiveInteger normalizes valid integers and applies fallback", () => {
  assert.equal(normalizePositiveInteger("12"), 12);
  assert.equal(normalizePositiveInteger(0), 0);
  assert.equal(normalizePositiveInteger(-1), 0);
  assert.equal(
    normalizePositiveInteger("abc", {
      fallback: null
    }),
    null
  );
});

test("normalizeOpaqueId preserves opaque identifiers", () => {
  assert.equal(normalizeOpaqueId("  user-123  "), "user-123");
  assert.equal(normalizeOpaqueId(7), 7);
  assert.equal(normalizeOpaqueId(0), 0);
  assert.equal(normalizeOpaqueId(10n), "10");
  assert.equal(normalizeOpaqueId(""), null);
  assert.equal(normalizeOpaqueId(null), null);
});

test("normalizeUniqueTextList trims, dedupes, and supports optional single values", () => {
  assert.deepEqual(normalizeUniqueTextList([" one ", "two", "one", "", null]), ["one", "two"]);
  assert.deepEqual(normalizeUniqueTextList("one"), []);
  assert.deepEqual(
    normalizeUniqueTextList(" one ", {
      acceptSingle: true
    }),
    ["one"]
  );
});
