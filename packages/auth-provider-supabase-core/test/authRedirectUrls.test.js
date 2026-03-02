import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOAuthLoginRedirectUrl,
  buildOtpLoginRedirectUrl
} from "../src/server/lib/authRedirectUrls.js";

test("buildOAuthLoginRedirectUrl targets /auth/login callback route", () => {
  const redirectTo = buildOAuthLoginRedirectUrl({
    appPublicUrl: "http://localhost:5173",
    provider: "google",
    providerIds: ["google"],
    returnTo: "/app"
  });

  const url = new URL(redirectTo);
  assert.equal(url.origin, "http://localhost:5173");
  assert.equal(url.pathname, "/auth/login");
  assert.equal(url.searchParams.get("oauthProvider"), "google");
  assert.equal(url.searchParams.get("oauthIntent"), "login");
  assert.equal(url.searchParams.get("oauthReturnTo"), "/app");
});

test("buildOAuthLoginRedirectUrl preserves app base path", () => {
  const redirectTo = buildOAuthLoginRedirectUrl({
    appPublicUrl: "https://example.com/tenant",
    provider: "google",
    providerIds: ["google"],
    returnTo: "/app"
  });

  const url = new URL(redirectTo);
  assert.equal(url.origin, "https://example.com");
  assert.equal(url.pathname, "/tenant/auth/login");
});

test("buildOtpLoginRedirectUrl targets /auth/login", () => {
  const redirectTo = buildOtpLoginRedirectUrl({
    appPublicUrl: "http://localhost:5173",
    returnTo: "/app"
  });

  const url = new URL(redirectTo);
  assert.equal(url.origin, "http://localhost:5173");
  assert.equal(url.pathname, "/auth/login");
  assert.equal(url.searchParams.get("returnTo"), "/app");
});
