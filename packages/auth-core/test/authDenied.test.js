import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_DENIED_CODES,
  normalizeAuthDenied,
  resolveAuthDeniedLoginMessage
} from "../src/shared/authDenied.js";

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
