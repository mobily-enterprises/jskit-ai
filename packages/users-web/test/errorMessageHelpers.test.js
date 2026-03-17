import test from "node:test";
import assert from "node:assert/strict";
import { toQueryErrorMessage, toUiErrorMessage } from "../src/client/composables/errorMessageHelpers.js";

test("toQueryErrorMessage returns empty when query has no error", () => {
  assert.equal(toQueryErrorMessage(null, "Unable to load list."), "");
});

test("toQueryErrorMessage resolves error message then fallback", () => {
  assert.equal(toQueryErrorMessage({ message: "Network timeout" }, "Unable to load list."), "Network timeout");
  assert.equal(toQueryErrorMessage({}, "Unable to load list."), "Unable to load list.");
});

test("toUiErrorMessage prefers fallback copy before runtime error text", () => {
  assert.equal(toUiErrorMessage({ message: "Server exploded" }, "Unable to save."), "Unable to save.");
  assert.equal(toUiErrorMessage({ message: "Server exploded" }, ""), "Server exploded");
});
