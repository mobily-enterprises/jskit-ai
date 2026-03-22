import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRegisterCompletionState } from "../src/client/composables/loginView/registerCompletion.js";

test("resolveRegisterCompletionState requires no immediate session when email confirmation is required", () => {
  const result = resolveRegisterCompletionState({
    ok: true,
    requiresEmailConfirmation: true,
    message: "Custom confirmation message"
  });

  assert.deepEqual(result, {
    shouldCompleteLogin: false,
    message: "Custom confirmation message"
  });
});

test("resolveRegisterCompletionState falls back to default confirmation message", () => {
  const result = resolveRegisterCompletionState({
    ok: true,
    requiresEmailConfirmation: true
  });

  assert.deepEqual(result, {
    shouldCompleteLogin: false,
    message: "Check your email to confirm the account before logging in."
  });
});

test("resolveRegisterCompletionState completes login when confirmation is not required", () => {
  const result = resolveRegisterCompletionState({
    ok: true,
    requiresEmailConfirmation: false
  });

  assert.deepEqual(result, {
    shouldCompleteLogin: true,
    message: ""
  });
});
