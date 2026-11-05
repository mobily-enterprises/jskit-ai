import assert from "node:assert/strict";
import test from "node:test";
import { catalogMessage, formatMessage, messageKeyForCode } from "@jskit-ai/kernel/shared/i18n";
import {
  AUTH_DENIED_CODES,
  AUTH_DENIED_DEFAULT_TEXTS,
  AUTH_DENIED_FALLBACK_TEXT,
  AUTH_DENIED_LOGIN_TEXTS,
  normalizeAuthDenied,
  resolveAuthDeniedLoginMessage,
  resolveAuthDeniedLoginText
} from "../src/shared/authDenied.js";
import en from "../locales/en.json" with { type: "json" };

test("normalizeAuthDenied preserves stable denial codes and messages", () => {
  assert.deepEqual(
    normalizeAuthDenied({
      code: "NOT_ALLOWLISTED",
      message: "  Custom denial.  "
    }),
    {
      code: AUTH_DENIED_CODES.NOT_ALLOWLISTED,
      message: "Custom denial."
    }
  );

  assert.deepEqual(
    normalizeAuthDenied({
      code: AUTH_DENIED_CODES.BLOCKED
    }),
    {
      code: AUTH_DENIED_CODES.BLOCKED,
      message: "This account has been blocked from accessing this application."
    }
  );

  assert.equal(normalizeAuthDenied({ message: "Missing code" }), null);
  assert.equal(normalizeAuthDenied({ code: "../bad" }), null);
});

test("resolveAuthDeniedLoginMessage maps default denial reasons to post-login messages", () => {
  assert.equal(
    resolveAuthDeniedLoginMessage({ code: AUTH_DENIED_CODES.NOT_ALLOWLISTED }),
    "Sign-in succeeded, but this account is not allowed to access this application."
  );
  assert.equal(
    resolveAuthDeniedLoginMessage({ code: AUTH_DENIED_CODES.BLOCKED }),
    "Sign-in succeeded, but this account has been blocked from accessing this application."
  );
  assert.equal(resolveAuthDeniedLoginMessage(null), "");
});

test("an app's own denial reason without a message gets the coded fallback", () => {
  assert.deepEqual(normalizeAuthDenied({ code: "trial_expired" }), {
    code: "trial_expired",
    message: "This account cannot access this application."
  });
  assert.equal(resolveAuthDeniedLoginText({ code: "trial_expired" }), AUTH_DENIED_FALLBACK_TEXT);
  assert.deepEqual(resolveAuthDeniedLoginText({ code: "trial_expired", message: "Your trial ended." }), {
    message: "Your trial ended."
  });
});

test("every coded denial text renders its English from the catalog", () => {
  const texts = [
    ...Object.values(AUTH_DENIED_DEFAULT_TEXTS),
    ...Object.values(AUTH_DENIED_LOGIN_TEXTS),
    AUTH_DENIED_FALLBACK_TEXT
  ];
  for (const { message, messageCode } of texts) {
    assert.equal(formatMessage(catalogMessage(en, messageKeyForCode(messageCode))), message, messageCode);
  }
});
