import assert from "node:assert/strict";
import test from "node:test";

import { normalizeReturnToPath } from "../src/server/utils.js";

test("normalizeReturnToPath keeps internal paths", () => {
  assert.equal(normalizeReturnToPath("/w/acme"), "/w/acme");
});

test("normalizeReturnToPath allows absolute urls for configured origins", () => {
  assert.equal(
    normalizeReturnToPath("https://app.example.com/w/acme", {
      fallback: "/",
      allowedOrigins: ["https://app.example.com", "https://admin.example.com"]
    }),
    "https://app.example.com/w/acme"
  );
});

test("normalizeReturnToPath rejects absolute urls for unconfigured origins", () => {
  assert.equal(
    normalizeReturnToPath("https://evil.example.com/phishing", {
      fallback: "/",
      allowedOrigins: ["https://app.example.com"]
    }),
    "/"
  );
});
