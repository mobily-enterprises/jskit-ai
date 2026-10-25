import { createSchema } from "json-rest-schema";

// A fixture-only provider whose first OAuth flow is client credentials and whose
// account modes depend on its settings, so the form must honour both.
const probeDefinition = Object.freeze({
  id: "probe-service",
  name: "Probe service",
  accountModes: ["per-user", "shared", "assistant"],
  accountModesForSettings: (settings) => settings?.tier === "basic" ? ["per-user", "assistant"] : ["per-user", "shared", "assistant"],
  authenticationMethods: ["api-key", "oauth2"],
  oauthGrantTypes: ["client_credentials", "authorization_code"],
  scopes: [{ value: "service.read", label: "Service read" }, { value: "user.read", label: "User read" }],
  scopesForGrantType: (grant) => grant === "client_credentials"
    ? [{ value: "service.read", label: "Service read", required: true, authenticationMethods: ["oauth2"] }]
    : [{ value: "user.read", label: "User read", required: true, authenticationMethods: ["oauth2"] }],
  settingsSchema: createSchema({ tier: { type: "string", enum: ["basic", "full"], defaultTo: "full" } }),
  settingsFields: [{
    name: "tier", label: "Tier", items: ["basic", "full"],
    hint: (settings) => `The ${settings?.tier || "full"} tier decides which accounts can connect.`
  }]
});

const probeIntegration = {
  provider: "probe-service", accountMode: "per-user", scopes: [],
  authentication: { method: "api-key", secretRef: "env:PROBE_KEY" }, settings: { tier: "basic" }
};

export { probeDefinition, probeIntegration };
