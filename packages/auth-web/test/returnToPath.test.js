import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAuthReturnToPath } from "../src/client/lib/returnToPath.js";

test("normalizeAuthReturnToPath keeps valid internal paths", () => {
  assert.equal(normalizeAuthReturnToPath("/dashboard"), "/dashboard");
  assert.equal(normalizeAuthReturnToPath("/w/acme/projects?tab=active"), "/w/acme/projects?tab=active");
  assert.equal(
    normalizeAuthReturnToPath("https://app.example.com/w/acme", "/", {
      allowedOrigins: ["https://app.example.com", "https://auth.example.com"]
    }),
    "https://app.example.com/w/acme"
  );
});

test("normalizeAuthReturnToPath falls back for invalid or auth-loop paths", () => {
  assert.equal(normalizeAuthReturnToPath("", "/"), "/");
  assert.equal(
    normalizeAuthReturnToPath("https://example.com", "/", {
      allowedOrigins: ["https://app.example.com"]
    }),
    "/"
  );
  assert.equal(normalizeAuthReturnToPath("//evil.com", "/"), "/");
  assert.equal(normalizeAuthReturnToPath("/auth/login", "/"), "/");
  assert.equal(normalizeAuthReturnToPath("/auth/login?returnTo=%2F", "/"), "/");
  assert.equal(normalizeAuthReturnToPath("/auth/signout", "/"), "/");
  assert.equal(normalizeAuthReturnToPath("/auth/signout?returnTo=%2F", "/"), "/");
  assert.equal(
    normalizeAuthReturnToPath("https://auth.example.com/auth/login", "/", {
      allowedOrigins: ["https://auth.example.com"]
    }),
    "/"
  );
});
