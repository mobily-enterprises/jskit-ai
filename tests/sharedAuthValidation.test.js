import assert from "node:assert/strict";
import test from "node:test";
import {
  constraints,
  normalizeEmail,
  normalizeOAuthIntent,
  normalizeReturnToPath,
  validators
} from "../shared/auth/index.js";

test("shared auth constraints expose expected defaults", () => {
  assert.equal(constraints.AUTH_EMAIL_MIN_LENGTH, 3);
  assert.equal(constraints.AUTH_EMAIL_MAX_LENGTH, 320);
  assert.equal(constraints.AUTH_PASSWORD_MIN_LENGTH, 8);
  assert.equal(constraints.AUTH_PASSWORD_MAX_LENGTH, 128);
  assert.equal(constraints.AUTH_LOGIN_PASSWORD_MAX_LENGTH, 1024);
  assert.equal(constraints.AUTH_RECOVERY_TOKEN_MAX_LENGTH, 4096);
});

test("normalizeEmail trims and lowercases email values", () => {
  assert.equal(normalizeEmail("  USER@Example.COM "), "user@example.com");
  assert.equal(normalizeEmail(""), "");
  assert.equal(normalizeEmail(null), "");
});

test("shared auth path helpers normalize oauth intent and returnTo", () => {
  assert.equal(normalizeOAuthIntent(" LINK "), "link");
  assert.equal(normalizeOAuthIntent("unknown"), "login");
  assert.equal(normalizeOAuthIntent("unknown", { fallback: "link" }), "link");

  assert.equal(normalizeReturnToPath("/w/acme?tab=security"), "/w/acme?tab=security");
  assert.equal(normalizeReturnToPath("https://example.com", { fallback: "/" }), "/");
  assert.equal(normalizeReturnToPath("//example.com/path", { fallback: "/fallback" }), "/fallback");
});

test("validators.email returns expected validation messages", () => {
  assert.equal(validators.email(""), "Email is required.");
  assert.equal(validators.email("not-an-email"), "Provide a valid email address.");
  assert.equal(validators.email("valid@example.com"), "");
});

test("validators.registerPassword and loginPassword enforce expected rules", () => {
  assert.equal(validators.registerPassword(""), "Password is required.");
  assert.equal(validators.registerPassword("short"), "Password must be between 8 and 128 characters.");
  assert.equal(validators.registerPassword("a".repeat(129)), "Password must be between 8 and 128 characters.");
  assert.equal(validators.registerPassword("GoodPass123"), "");
  assert.equal(validators.resetPassword("GoodPass123"), "");

  assert.equal(validators.loginPassword(""), "Password is required.");
  assert.equal(validators.loginPassword("a".repeat(1025)), "Password must be at most 1024 characters.");
  assert.equal(validators.loginPassword("ok"), "");
});

test("validators.confirmPassword covers required, mismatch, and success branches", () => {
  assert.equal(validators.confirmPassword({ password: "abc", confirmPassword: "" }), "Confirm your password.");
  assert.equal(validators.confirmPassword({ password: "abc", confirmPassword: "def" }), "Passwords do not match.");
  assert.equal(validators.confirmPassword({ confirmPassword: "abc" }), "Passwords do not match.");
  assert.equal(validators.confirmPassword({ password: "abc", confirmPassword: "abc" }), "");
});

test("validators.registerInput/loginInput/forgot/reset return normalized payloads and field errors", () => {
  assert.deepEqual(validators.registerInput({ email: "", password: "" }).fieldErrors, {
    email: "Email is required.",
    password: "Password is required."
  });

  const login = validators.loginInput({
    email: "  USER@Example.COM  ",
    password: "pass"
  });
  assert.equal(login.email, "user@example.com");
  assert.equal(login.password, "pass");
  assert.deepEqual(login.fieldErrors, {});

  assert.deepEqual(validators.loginInput({ email: "", password: "" }).fieldErrors, {
    email: "Email is required.",
    password: "Password is required."
  });

  assert.deepEqual(validators.forgotPasswordInput({ email: "bad" }).fieldErrors, {
    email: "Provide a valid email address."
  });

  assert.deepEqual(validators.resetPasswordInput({ password: "short" }).fieldErrors, {
    password: "Password must be between 8 and 128 characters."
  });
});
