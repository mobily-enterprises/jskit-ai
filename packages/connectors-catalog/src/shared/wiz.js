import { createSchema } from "json-rest-schema";

const wizDefinition = Object.freeze({
  id: "wiz", name: "Wiz", description: "Scan project source with your Wiz security policies.",
  accountModes: ["shared"], authenticationMethods: ["oauth2"], scopes: [],
  oauthGrantTypes: ["client_credentials"], oauthClientAuthenticationMethods: ["client_secret_post"],
  validateClientId: (value) => !/[\s\p{Cc}]/u.test(value) || "Use the Wiz service-account Client ID without whitespace or control characters.",
  authenticationLabels: { oauth2: "Wiz service account" },
  authenticationHint: "A source scanner uses your workspace's service account. It does not sign app users in. The installed Wiz CLI performs authentication when a scan runs.",
  settingsSchema: createSchema({
    tokenUrl: { type: "string", enum: ["https://auth.app.wiz.io/oauth/token", "https://auth.wiz.io/oauth/token"],
      defaultTo: "https://auth.app.wiz.io/oauth/token" },
    policies: { type: "string", maxLength: 4096, noTrim: true,
      validator: (value) => (value.split(",").length <= 50 && value.split(",").every((item) => item.trim().length > 0 && item.trim().length <= 200) && !/\p{Cc}/u.test(value)) ||
        "Use up to 50 comma-separated policy names, without empty names or control characters." },
    byPolicyHits: { type: "string", enum: ["BLOCK", "AUDIT", "DISABLED"], defaultTo: "BLOCK" }
  }),
  settingsFields: [
    { name: "tokenUrl", label: "Token URL", items: [
      { value: "https://auth.app.wiz.io/oauth/token", title: "Cognito (auth.app.wiz.io)" },
      { value: "https://auth.wiz.io/oauth/token", title: "Auth0 (auth.wiz.io)" }
    ], hint: "The current Wiz v1 runner supports Cognito. Auth0 configuration can be saved, but requires a verified compatible runner before scanning." },
    { name: "policies", label: "CI/CD scan policies", placeholder: "Default vulnerabilities policy, Default IaC policy",
      hint: "Optional comma-separated policy names. Leave blank to use your Wiz tenant's defaults." },
    { name: "byPolicyHits", label: "Filter findings by policy hits", items: [
      { value: "BLOCK", title: "Blocking policy hits (BLOCK)" },
      { value: "AUDIT", title: "Blocking or audit policy hits (AUDIT)" },
      { value: "DISABLED", title: "All findings (DISABLED)" }
    ], hint: "Filtering reported findings does not disable Wiz's policy verdict." }
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
