import assert from "node:assert/strict";
import test from "node:test";
import { getProviderSetup, isProviderConfigurationOnly } from "../src/shared/configuration.js";

const provider = {
  configurationOnlyForSettings: (settings) => settings.mode === "public",
  setup: {
    url: "https://example.test/token", steps: ["Create a token."],
    urlByAuthentication: { oauth2: "https://example.test/oauth" }, stepsByAuthentication: { oauth2: ["Register a client."] },
    urlForSettings: (settings) => settings.mode === "mcp" ? "https://example.test/mcp" : undefined,
    stepsForSettings: (settings, method) => settings.mode === "mcp" ? [`Register an MCP client for ${method}.`] : undefined
  }
};

test("provider setup resolves settings, then authentication method, then static text", () => {
  assert.deepEqual(getProviderSetup(provider, {}, "api-key"), { url: "https://example.test/token", steps: ["Create a token."] });
  assert.deepEqual(getProviderSetup(provider, {}, "oauth2"), { url: "https://example.test/oauth", steps: ["Register a client."] });
  assert.deepEqual(getProviderSetup(provider, { mode: "mcp" }, "oauth2"),
    { url: "https://example.test/mcp", steps: ["Register an MCP client for oauth2."] });
  assert.deepEqual(getProviderSetup({ setup: { url: "https://example.test", steps: [] } }),
    { url: "https://example.test", steps: [] });
});

test("configuration-only providers resolve static and settings-dependent flags", () => {
  assert.equal(isProviderConfigurationOnly({ configurationOnly: true }), true);
  assert.equal(isProviderConfigurationOnly(provider, { mode: "public" }), true);
  assert.equal(isProviderConfigurationOnly(provider, {}), false);
});
