import test from "node:test";
import assert from "node:assert/strict";
import { formatDateTime } from "./formatDateTime.js";

test("formatDateTime returns fallback for invalid values", () => {
  assert.equal(formatDateTime("not-a-date"), "unknown");
  assert.equal(formatDateTime("not-a-date", { fallback: "n/a" }), "n/a");
});

test("formatDateTime formats valid date-like values", () => {
  const formatted = formatDateTime("2026-03-14T12:34:56.000Z");
  assert.equal(typeof formatted, "string");
  assert.ok(formatted.length > 0);
  assert.notEqual(formatted, "unknown");
});
