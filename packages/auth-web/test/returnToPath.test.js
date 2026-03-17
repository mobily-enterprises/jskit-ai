import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAuthReturnToPath } from "../src/client/lib/returnToPath.js";

test("normalizeAuthReturnToPath keeps valid internal paths", () => {
  assert.equal(normalizeAuthReturnToPath("/dashboard"), "/dashboard");
  assert.equal(normalizeAuthReturnToPath("/w/acme/projects?tab=active"), "/w/acme/projects?tab=active");
});

test("normalizeAuthReturnToPath falls back for invalid or auth-loop paths", () => {
  assert.equal(normalizeAuthReturnToPath("", "/"), "/");
  assert.equal(normalizeAuthReturnToPath("https://example.com", "/"), "/");
  assert.equal(normalizeAuthReturnToPath("//evil.com", "/"), "/");
  assert.equal(normalizeAuthReturnToPath("/auth/login", "/"), "/");
  assert.equal(normalizeAuthReturnToPath("/auth/login?returnTo=%2F", "/"), "/");
  assert.equal(normalizeAuthReturnToPath("/auth/signout", "/"), "/");
  assert.equal(normalizeAuthReturnToPath("/auth/signout?returnTo=%2F", "/"), "/");
});
