import assert from "node:assert/strict";
import test from "node:test";
import { catalogMessage, formatMessage, messageKeyForCode } from "@jskit-ai/kernel/shared/i18n";

import english from "../locales/en.json" with { type: "json" };
import {
  AUTH_TEXTS,
  authFieldError,
  authFieldErrorDetails,
  authMessageFields,
  createAuthError
} from "../src/server/authTexts.js";
import { createUnsupportedAuthOperationError } from "../src/server/unsupportedOperation.js";
import { loginInput, registerInput, resetPasswordInput, confirmPassword } from "../src/server/validators.js";
import { AUTH_DENIED_CODES, resolveAuthDeniedLoginText } from "../src/shared/authDenied.js";

function rendered(code, params = {}) {
  return formatMessage(catalogMessage(english, messageKeyForCode(code)), params);
}

test("shared auth texts throw their catalog English under their code", () => {
  const error = createAuthError(AUTH_TEXTS.sessionRequired);
  assert.equal(error.status, 401);
  assert.equal(error.message, "Authentication required.");
  assert.equal(error.code, "auth.session.required");
  assert.deepEqual(error.params, {});

  assert.equal(createAuthError(AUTH_TEXTS.sessionUnavailable).message,
    "Authentication service temporarily unavailable. Please retry.");
  assert.equal(createAuthError(AUTH_TEXTS.invalidCredentials).message, "Invalid email or password.");
  assert.deepEqual(authFieldError(AUTH_TEXTS.displayNameRequired), {
    code: "auth.profile.displayNameRequired",
    params: {},
    message: "Display name is required."
  });
  assert.deepEqual(authFieldErrorDetails({ userId: AUTH_TEXTS.devUserNotFound }), {
    fieldErrors: { userId: "User not found." },
    fieldErrorCodes: { userId: { code: "auth.dev.userNotFound", params: {} } }
  });
  assert.deepEqual(authMessageFields(AUTH_TEXTS.passwordUpdatedSignIn), {
    message: "Password updated. Sign in with your new password.",
    messageCode: "auth.password.updatedSignIn",
    messageParams: {}
  });
});

test("an unsupported operation keeps its code and adds a translatable message code", () => {
  const error = createUnsupportedAuthOperationError("oauthStart");
  assert.equal(error.code, "AUTH_OPERATION_UNSUPPORTED");
  assert.equal(error.messageCode, "auth.operation.unsupported");
  assert.equal(rendered(error.messageCode, error.messageParams), error.message);
});

test("server validator field errors render the same from their codes", () => {
  const results = [
    registerInput({ email: "", password: "" }),
    registerInput({ email: "not-an-email", password: "short" }),
    loginInput({ email: "a@example.com", password: "x".repeat(2000) }),
    resetPasswordInput({ password: "" })
  ];
  for (const { fieldErrors, fieldErrorCodes } of results) {
    assert.deepEqual(Object.keys(fieldErrorCodes), Object.keys(fieldErrors));
    for (const [field, message] of Object.entries(fieldErrors)) {
      assert.equal(rendered(fieldErrorCodes[field].code, fieldErrorCodes[field].params), message, field);
    }
  }
  assert.equal(confirmPassword("one", "two"), "Passwords do not match.");
});

test("built-in sign-in denials carry the code of their English", () => {
  for (const code of Object.values(AUTH_DENIED_CODES)) {
    const text = resolveAuthDeniedLoginText({ code });
    assert.equal(rendered(text.messageCode), text.message);
  }
  assert.deepEqual(resolveAuthDeniedLoginText({ code: "app_specific", message: "Ask your admin." }), {
    message: "Ask your admin."
  });
});
