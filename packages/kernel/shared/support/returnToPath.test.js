import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAllowedOrigins,
  normalizeHttpOrigin,
  normalizeReturnToPath,
  resolveAllowedOriginsFromPlacementContext
} from "./returnToPath.js";

test("normalizeHttpOrigin keeps valid http origins only", () => {
  assert.equal(normalizeHttpOrigin("https://app.example.com/path?q=1"), "https://app.example.com");
  assert.equal(normalizeHttpOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeHttpOrigin("javascript:alert(1)"), "");
});

test("normalizeAllowedOrigins deduplicates and filters invalid origins", () => {
  assert.deepEqual(normalizeAllowedOrigins([
    "https://app.example.com",
    "https://app.example.com/console",
    "http://localhost:5173",
    "",
    "ftp://files.example.com"
  ]), [
    "https://app.example.com",
    "http://localhost:5173"
  ]);
});

test("normalizeReturnToPath allows internal paths and permitted absolute urls", () => {
  assert.equal(normalizeReturnToPath("/w/acme/projects?tab=active", {
    fallback: "/"
  }), "/w/acme/projects?tab=active");
  assert.equal(normalizeReturnToPath("https://app.example.com/w/acme", {
    fallback: "/",
    allowedOrigins: ["https://app.example.com"]
  }), "https://app.example.com/w/acme");
});

test("normalizeReturnToPath rejects blocked paths, invalid schemes, and untrusted origins", () => {
  assert.equal(normalizeReturnToPath("/auth/login?returnTo=%2F", {
    fallback: "/",
    blockedPathnames: ["/auth/login"]
  }), "/");
  assert.equal(normalizeReturnToPath("https://auth.example.com/auth/signout", {
    fallback: "/",
    allowedOrigins: ["https://auth.example.com"],
    blockedPathnames: ["/auth/signout"]
  }), "/");
  assert.equal(normalizeReturnToPath("https://evil.example.com/phishing", {
    fallback: "/",
    allowedOrigins: ["https://app.example.com"]
  }), "/");
  assert.equal(normalizeReturnToPath("javascript:alert(1)", {
    fallback: "/"
  }), "/");
  assert.equal(normalizeReturnToPath("/account/settings", {
    fallback: "/",
    blockedPathnames: ["account/settings"]
  }), "/");
});

test("normalizeReturnToPath can read first value from array payloads", () => {
  assert.equal(normalizeReturnToPath(["/dashboard", "/ignored"], {
    fallback: "/",
    pickFirstArrayValue: true
  }), "/dashboard");
});

test("resolveAllowedOriginsFromPlacementContext collects current and surface origins", () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: {
      origin: "https://current.example.com"
    }
  };

  try {
    const origins = resolveAllowedOriginsFromPlacementContext({
      surfaceConfig: {
        surfacesById: {
          home: { origin: "https://home.example.com" },
          app: { origin: "https://app.example.com" },
          duplicate: { origin: "https://home.example.com" },
          invalid: { origin: "mailto:hello@example.com" }
        }
      }
    });

    assert.deepEqual(origins, [
      "https://current.example.com",
      "https://home.example.com",
      "https://app.example.com"
    ]);
  } finally {
    if (typeof originalWindow === "undefined") {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});
