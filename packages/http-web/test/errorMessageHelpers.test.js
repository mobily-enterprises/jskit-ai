import test from "node:test";
import assert from "node:assert/strict";
import { toQueryErrorMessage, toUiErrorMessage } from "../src/client/composables/support/errorMessageHelpers.js";

test("toQueryErrorMessage returns empty when query has no error", () => {
  assert.equal(toQueryErrorMessage(null, "Unable to load list."), "");
});

test("toQueryErrorMessage resolves specific runtime error messages before fallback", () => {
  assert.equal(toQueryErrorMessage({ message: "Network timeout" }, "Unable to load list."), "Network timeout");
  assert.equal(toQueryErrorMessage({}, "Unable to load list."), "Unable to load list.");
});

test("toQueryErrorMessage prefers fallback for generic transport messages", () => {
  assert.equal(
    toQueryErrorMessage({ status: 500, message: "Request failed with status 500." }, "Unable to load list."),
    "Unable to load list."
  );
  assert.equal(
    toQueryErrorMessage({ status: 0, message: "Network request failed." }, "Unable to load list."),
    "Unable to load list."
  );
});

test("toUiErrorMessage prefers fallback copy before runtime error text", () => {
  assert.equal(toUiErrorMessage({ message: "Server exploded" }, "Unable to save."), "Unable to save.");
  assert.equal(toUiErrorMessage({ message: "Server exploded" }, ""), "Server exploded");
});
