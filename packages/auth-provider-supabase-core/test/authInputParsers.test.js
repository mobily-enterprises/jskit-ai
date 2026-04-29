import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOAuthProviderInput } from "../src/server/lib/authInputParsers.js";

test("normalizeOAuthProviderInput uses the configured default provider", () => {
  const provider = normalizeOAuthProviderInput("", {
    providerIds: ["github", "google"],
    defaultProvider: "github"
  });

  assert.equal(provider, "github");
});

test("normalizeOAuthProviderInput rejects oauth sign-in when no providers are configured", () => {
  assert.throws(
    () =>
      normalizeOAuthProviderInput("github", {
        providerIds: [],
        defaultProvider: null
      }),
    (error) => {
      assert.equal(error?.status, 400);
      assert.equal(String(error?.details?.fieldErrors?.provider || "").length > 0, true);
      return true;
    }
  );
});
