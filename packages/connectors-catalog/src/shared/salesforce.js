import { createSchema } from "json-rest-schema";

const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const production = new RegExp(`^https://${label}(?:\\.develop)?\\.my\\.salesforce\\.com/?$`, "u");
const sandbox = new RegExp(`^https://${label}\\.sandbox\\.my\\.salesforce\\.com/?$`, "u");
const salesforceDefinition = Object.freeze({
  id: "salesforce", name: "Salesforce", description: "Explore Salesforce objects and read records with your organisation's API permissions.",
  accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
  oauthClientAuthenticationMethods: ["client_secret_post"],
  settingsSchema: createSchema({
    environment: { type: "string", enum: ["production", "sandbox"], defaultTo: "production" },
    accountUrl: { type: "string", required: true, noTrim: true, maxLength: 253, validator: (value, object) =>
      (object.environment === "sandbox" ? sandbox : production).test(value) || "Enter a lowercase HTTPS My Domain URL matching the selected environment, without a path, query or port." }
  }),
  settingsFields: [
    { name: "environment", label: "Environment", items: [{ value: "production", title: "Production" }, { value: "sandbox", title: "Sandbox" }],
      hint: "Production includes Developer Edition. Sandbox uses the org's .sandbox.my.salesforce.com domain." },
    { name: "accountUrl", label: "Account URL", placeholder: "https://acme.my.salesforce.com",
      hint: "Copy My Domain from Salesforce Setup. The same org receives authorization and API requests." }
  ],
  scopes: [
    { value: "api", label: "Access Salesforce APIs with this user's permissions", recommended: true },
    { value: "refresh_token", label: "Keep access when the user is away", recommended: true }
  ],
  permissionsHint: "Salesforce's api permission can allow writes. This runtime exposes reads; your app still authorizes each query. Connecting an account does not sign the person into your application.",
  setup: { url: "https://help.salesforce.com/s/articleView?id=sf.external_client_apps.htm&type=5", steps: [
    "In Salesforce Setup, open My Domain and copy the org's login URL. Select Production for production/Developer Edition or Sandbox for a sandbox org.",
    "Open External Client App Manager and create an External Client App. Enter its name, API name and contact email; use Local for an app used only by this org.",
    "Enable OAuth, register the exact backend callback, and select api plus refresh_token/offline_access. Keep PKCE enabled and require the secret for Web Server and Refresh Token flows.",
    "Open the app's Settings, then Consumer Key and Secret. Copy the key as Client ID; put the secret and callback in Env and save their references here.",
    "An administrator grants API access and authorizes the app/users through its policies and permission sets. Save configuration, then start consent from your application's connection flow.",
    "Public/Online registrations need separate provisioning and distribution decisions. Local apps cannot serve unrelated customer orgs; packaged apps require installation and subscriber policies. Org API quotas remain shared."
  ] }
});

export { salesforceDefinition };
