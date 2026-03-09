import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_METHOD_IDS,
  AUTH_METHOD_KINDS,
  buildAuthMethodDefinitions,
  buildAuthMethodIds,
  buildOAuthMethodDefinitions,
  buildOAuthMethodId,
  findAuthMethodDefinition,
  parseAuthMethodId
} from "../src/shared/authMethods.js";
import {
  isValidOAuthProviderId,
  normalizeOAuthProviderId,
  normalizeOAuthProviderList
} from "../src/shared/oauthProviders.js";

test("oauth provider helpers normalize ids and lists", () => {
  assert.equal(normalizeOAuthProviderId(" Google "), "google");
  assert.equal(normalizeOAuthProviderId(""), null);
  assert.equal(normalizeOAuthProviderId("x"), null);
  assert.equal(normalizeOAuthProviderId("", { fallback: "github" }), "github");

  assert.equal(isValidOAuthProviderId("github"), true);
  assert.equal(isValidOAuthProviderId("bad provider"), false);

  assert.deepEqual(normalizeOAuthProviderList([" google ", "github", "google", "bad provider"]), [
    "google",
    "github"
  ]);
  assert.deepEqual(normalizeOAuthProviderList("google, github, invalid provider"), ["google", "github"]);
  assert.deepEqual(normalizeOAuthProviderList("", { fallback: ["google"] }), ["google"]);
});

test("auth method builders build provider-aware oauth method definitions", () => {
  const oauthMethods = buildOAuthMethodDefinitions([
    { id: "google", label: "Google" },
    { id: "github", label: "GitHub" },
    { id: "google", label: "Duplicate" },
    { id: "bad provider", label: "Invalid" }
  ]);

  assert.deepEqual(
    oauthMethods.map((method) => method.id),
    ["oauth:google", "oauth:github"]
  );

  const methods = buildAuthMethodDefinitions({
    oauthProviders: [
      { id: "google", label: "Google" },
      { id: "github", label: "GitHub" }
    ]
  });
  assert.deepEqual(methods.map((method) => method.id), ["password", "email_otp", "oauth:google", "oauth:github"]);

  const ids = buildAuthMethodIds({
    oauthProviders: [
      { id: "google", label: "Google" },
      { id: "github", label: "GitHub" }
    ]
  });
  assert.deepEqual(ids, ["password", "email_otp", "oauth:google", "oauth:github"]);
});

test("auth method helpers parse generic oauth ids while definition lookup remains catalog-based", () => {
  assert.deepEqual(parseAuthMethodId("password"), {
    id: "password",
    kind: "password",
    provider: "email"
  });

  assert.deepEqual(parseAuthMethodId("oauth:github"), {
    id: "oauth:github",
    kind: "oauth",
    provider: "github"
  });

  assert.equal(parseAuthMethodId("oauth:bad provider"), null);
  assert.equal(parseAuthMethodId("unknown"), null);

  assert.equal(findAuthMethodDefinition("oauth:github"), null);
  assert.equal(
    findAuthMethodDefinition("oauth:github", {
      oauthProviders: [{ id: "github", label: "GitHub" }]
    })?.label,
    "GitHub"
  );

  assert.deepEqual(AUTH_METHOD_IDS, ["password", "email_otp"]);
  assert.deepEqual(AUTH_METHOD_KINDS, ["password", "otp", "oauth"]);
  assert.equal(buildOAuthMethodId("google"), "oauth:google");
  assert.equal(buildOAuthMethodId("x"), null);
});
