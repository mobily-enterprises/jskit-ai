import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SUPABASE_OAUTH_PROVIDER_IDS,
  resolveSupabaseOAuthProviderCatalog
} from "../src/server/lib/oauthProviderCatalog.js";

test("oauth provider catalog defaults to no providers", () => {
  assert.deepEqual(DEFAULT_SUPABASE_OAUTH_PROVIDER_IDS, []);

  const catalog = resolveSupabaseOAuthProviderCatalog();
  assert.deepEqual(catalog.providers, []);
  assert.deepEqual(catalog.providerIds, []);
  assert.equal(catalog.defaultProvider, null);
});

test("oauth provider catalog uses explicit provider configuration", () => {
  const catalog = resolveSupabaseOAuthProviderCatalog({
    oauthProviders: ["github", "google"],
    oauthDefaultProvider: "google"
  });

  assert.deepEqual(
    catalog.providers.map((provider) => provider.id),
    ["github", "google"]
  );
  assert.equal(catalog.defaultProvider, "google");
});
