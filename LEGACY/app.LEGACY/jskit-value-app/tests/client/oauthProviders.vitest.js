import { beforeEach, describe, expect, it, vi } from "vitest";

describe("oauth provider filtering", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("uses all supported providers when no app filter is configured", async () => {
    const oauth = await import("../../src/modules/auth/oauthProviders.js");

    expect(oauth.APP_OAUTH_PROVIDER_IDS.length).toBeGreaterThan(0);
    expect(oauth.APP_OAUTH_PROVIDER_IDS).toContain(oauth.APP_OAUTH_DEFAULT_PROVIDER);
    expect(oauth.appOAuthProviders.map((provider) => provider.id)).toEqual(oauth.APP_OAUTH_PROVIDER_IDS);
  });

  it("filters providers using VITE_ENABLED_OAUTH_PROVIDERS and falls back to default when empty", async () => {
    vi.stubEnv("VITE_ENABLED_OAUTH_PROVIDERS", "unknown-provider");
    const oauth = await import("../../src/modules/auth/oauthProviders.js");

    expect(oauth.APP_OAUTH_PROVIDER_IDS).toEqual([oauth.APP_OAUTH_DEFAULT_PROVIDER]);
    expect(oauth.normalizeAppOAuthProvider("unknown-provider")).toBe(oauth.APP_OAUTH_DEFAULT_PROVIDER);
  });
});
