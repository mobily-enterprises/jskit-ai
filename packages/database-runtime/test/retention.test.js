import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBatchSize, normalizeCutoffDateOrThrow, normalizeDeletedRowCount } from "../src/shared/retention.js";

test("normalizeBatchSize clamps to configured max", () => {
  assert.equal(normalizeBatchSize(undefined, { fallback: 100, max: 500 }), 100);
  assert.equal(normalizeBatchSize(0, { fallback: 100, max: 500 }), 100);
  assert.equal(normalizeBatchSize(250, { fallback: 100, max: 500 }), 250);
  assert.equal(normalizeBatchSize(700, { fallback: 100, max: 500 }), 500);
});

test("normalizeCutoffDateOrThrow validates date", () => {
  assert.ok(normalizeCutoffDateOrThrow("2024-01-01T00:00:00.000Z") instanceof Date);
  assert.throws(() => normalizeCutoffDateOrThrow("invalid"), /Invalid cutoff date\./);
});

test("normalizeDeletedRowCount returns bounded non-negative number", () => {
  assert.equal(normalizeDeletedRowCount(3), 3);
  assert.equal(normalizeDeletedRowCount(-1), 0);
  assert.equal(normalizeDeletedRowCount("x"), 0);
});
