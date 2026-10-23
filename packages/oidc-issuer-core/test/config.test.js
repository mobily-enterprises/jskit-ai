import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveHubConfig } from "../src/server/config.js";

const base = {
  OIDC_HUB_REGISTRATION_TOKEN: "a-registration-token-of-enough-length",
  OIDC_HUB_OWNER_EMAIL: "Owner@Example.test",
  OIDC_HUB_SECRET: "x".repeat(48)
};
const production = {
  ...base,
  NODE_ENV: "production",
  APP_PUBLIC_URL: "https://accounts.example.test",
  OIDC_HUB_EMAIL_FROM: "hub@example.test",
  RESEND_API_KEY: "re_test"
};

test("a complete production configuration is accepted", () => {
  const config = resolveHubConfig(production);
  assert.equal(config.issuer, "https://accounts.example.test");
  assert.equal(config.ownerEmail, "owner@example.test");
  assert.equal(config.secure, true);
});

test("each production problem is one sentence naming the variable", () => {
  const cases = [
    [{ APP_PUBLIC_URL: "" }, /^Set APP_PUBLIC_URL/u],
    [{ APP_PUBLIC_URL: "http://accounts.example.test" }, /APP_PUBLIC_URL must use https/u],
    [{ APP_PUBLIC_URL: "https://accounts.example.test/hub" }, /without a path/u],
    [{ OIDC_HUB_SECRET: "" }, /^Set OIDC_HUB_SECRET/u],
    [{ OIDC_HUB_SECRET: "short" }, /OIDC_HUB_SECRET is too short/u],
    [{ OIDC_HUB_REGISTRATION_TOKEN: "" }, /^Set OIDC_HUB_REGISTRATION_TOKEN/u],
    [{ OIDC_HUB_OWNER_EMAIL: "" }, /^Set OIDC_HUB_OWNER_EMAIL/u],
    [{ RESEND_API_KEY: "" }, /OIDC_HUB_EMAIL_FROM and either RESEND_API_KEY or SMTP_URL/u],
    [{ OIDC_HUB_GOOGLE_CLIENT_ID: "only-id" }, /both OIDC_HUB_GOOGLE_CLIENT_ID and OIDC_HUB_GOOGLE_CLIENT_SECRET/u],
    [{ OIDC_HUB_DEV_ORIGIN_PATTERNS: "http://x.example.test" }, /must look like https/u],
    [{ OIDC_HUB_DEV_ORIGIN_PATTERNS: "https://app.*.dev" }, /only below the registered domain/u]
  ];
  for (const [change, message] of cases) {
    assert.throws(() => resolveHubConfig({ ...production, ...change }), (error) => {
      assert.match(error.message, message, JSON.stringify(change));
      assert.equal(error.message.split(". ").length <= 2, true);
      return true;
    });
  }
});

test("development falls back to localhost and accepts development patterns", () => {
  const config = resolveHubConfig(
    { ...base, PORT: "3009", OIDC_HUB_DEV_ORIGIN_PATTERNS: "https://v64preview-*--acme.vibe64.dev, https://*.staging.example.test" }
  );
  assert.equal(config.issuer, "http://localhost:3009");
  assert.deepEqual(config.devOriginPatterns, ["https://v64preview-*--acme.vibe64.dev", "https://*.staging.example.test"]);
});
