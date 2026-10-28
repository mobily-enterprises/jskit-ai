import { createSchema } from "json-rest-schema";

const wizDefinition = Object.freeze({
  id: "wiz", name: "Wiz", description: "jskit.connectors.wiz.description",
  accountModes: ["shared"], authenticationMethods: ["oauth2"], scopes: [],
  oauthGrantTypes: ["client_credentials"], oauthClientAuthenticationMethods: ["client_secret_post"],
  validateClientId: (value) => !/[\s\p{Cc}]/u.test(value) || "Use the Wiz service-account Client ID without whitespace or control characters.",
  authenticationLabels: { oauth2: "jskit.connectors.wiz.authenticationLabels.oauth2" },
  authenticationHint: "jskit.connectors.wiz.authenticationHint",
  settingsSchema: createSchema({
    tokenUrl: { type: "string", enum: ["https://auth.app.wiz.io/oauth/token", "https://auth.wiz.io/oauth/token"],
      defaultTo: "https://auth.app.wiz.io/oauth/token" },
    policies: { type: "string", maxLength: 4096, noTrim: true,
      validator: (value) => (value.split(",").length <= 50 && value.split(",").every((item) => item.trim().length > 0 && item.trim().length <= 200) && !/\p{Cc}/u.test(value)) ||
        "Use up to 50 comma-separated policy names, without empty names or control characters." },
    byPolicyHits: { type: "string", enum: ["BLOCK", "AUDIT", "DISABLED"], defaultTo: "BLOCK" }
  }),
  settingsFields: [
    { name: "tokenUrl", label: "jskit.connectors.wiz.fields.tokenUrl.label", items: [
      { value: "https://auth.app.wiz.io/oauth/token", title: "jskit.connectors.wiz.fields.tokenUrl.items.httpsAuthAppWizIoOauthToken.title" },
      { value: "https://auth.wiz.io/oauth/token", title: "jskit.connectors.wiz.fields.tokenUrl.items.httpsAuthWizIoOauthToken.title" }
    ], hint: "jskit.connectors.wiz.fields.tokenUrl.hint" },
    { name: "policies", label: "jskit.connectors.wiz.fields.policies.label", placeholder: "jskit.connectors.wiz.fields.policies.placeholder",
      hint: "jskit.connectors.wiz.fields.policies.hint" },
    { name: "byPolicyHits", label: "jskit.connectors.wiz.fields.byPolicyHits.label", items: [
      { value: "BLOCK", title: "jskit.connectors.wiz.fields.byPolicyHits.items.bLOCK.title" },
      { value: "AUDIT", title: "jskit.connectors.wiz.fields.byPolicyHits.items.aUDIT.title" },
      { value: "DISABLED", title: "jskit.connectors.wiz.fields.byPolicyHits.items.dISABLED.title" }
    ], hint: "jskit.connectors.wiz.fields.byPolicyHits.hint" }
  ],
  setup: { url: "https://marketplace.visualstudio.com/items?itemName=WizCloud.wiz-task", steps: [
    "Ask your Wiz administrator for a service account or deployment scoped to the projects you intend to scan, with create:security_scans permission.",
    "Copy its Client ID and store its Client Secret in Env. Enter the secret reference, not the secret itself.",
    "Confirm the tenant's authentication endpoint. The current runtime supports the Cognito endpoint; Auth0 execution is not implemented.",
    "Optionally enter existing CI/CD scan policy names and choose which policy hits to report. Missing policies are scan failures.",
    "Install an approved Wiz v1 CLI on the scan runner. A host-authorised source directory is scanned only when the source.scan operation is invoked.",
    "Workspace access, scan scheduling and security-result presentation are host responsibilities. Saving this configuration does not automatically scan all projects."
  ] }
});

export { wizDefinition };
