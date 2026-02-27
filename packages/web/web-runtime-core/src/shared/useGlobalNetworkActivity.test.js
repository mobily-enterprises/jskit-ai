import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DELAY_MS, DEFAULT_MIN_VISIBLE_MS, __testables } from "./useGlobalNetworkActivity.js";

test("normalizeDuration returns fallback for invalid values", () => {
  assert.equal(__testables.normalizeDuration(undefined, 100), 100);
  assert.equal(__testables.normalizeDuration("abc", 100), 100);
  assert.equal(__testables.normalizeDuration(-1, 100), 100);
});

test("normalizeDuration floors valid values", () => {
  assert.equal(__testables.normalizeDuration(0, DEFAULT_DELAY_MS), 0);
  assert.equal(__testables.normalizeDuration(10.9, DEFAULT_DELAY_MS), 10);
  assert.equal(__testables.normalizeDuration("250.8", DEFAULT_MIN_VISIBLE_MS), 250);
});

test("resolveNetworkBusy reports busy when fetches or mutations are active", () => {
  assert.equal(__testables.resolveNetworkBusy(0, 0), false);
  assert.equal(__testables.resolveNetworkBusy(1, 0), true);
  assert.equal(__testables.resolveNetworkBusy(0, 1), true);
  assert.equal(__testables.resolveNetworkBusy(2, 3), true);
});
