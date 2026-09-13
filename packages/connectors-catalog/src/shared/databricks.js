import { createSchema } from "json-rest-schema";

function validWorkspaceUrl(value) {
  // Use a per-workspace origin. Account consoles, regional URLs and proxy hosts are different contracts.
  return /^https:\/\/(?:dbc-[a-z0-9]+(?:-[a-z0-9]+)*\.cloud\.databricks\.com|adb-[0-9]+\.[0-9]+\.azuredatabricks\.net|[0-9]+\.[0-9]+\.gcp\.databricks\.com)\/?$/u.test(value);
}
const scopes = [
  { value: "all-apis", label: "APIs allowed by the connected account", recommended: true },
  { value: "offline_access", label: "Keep user access between visits", recommended: true },
  { value: "jobs", label: "Jobs API access for the service account" }
];
const databricksDefinition = Object.freeze({
  id: "databricks", name: "Databricks", description: "Read workspace jobs through user consent or a service principal.",
  accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
  oauthGrantTypes: ["authorization_code", "client_credentials"],
  oauthClientAuthenticationMethods: (grantType) => grantType === "client_credentials" ? ["client_secret_basic"] : ["client_secret_post"],
  oauthGrantHint: "User consent needs a custom OAuth application. Service account needs a service principal's client ID and OAuth secret, without a callback.",
  settingsSchema: createSchema({ workspaceUrl: { type: "string", required: true, maxLength: 253,
    validator: (value) => validWorkspaceUrl(value) || "Enter the HTTPS per-workspace URL for Databricks on AWS, Azure or Google Cloud, without a path or query." } }),
  settingsFields: [{ name: "workspaceUrl", label: "Workspace URL", placeholder: "https://dbc-abc123.cloud.databricks.com",
    hint: "Use the workspace's own address. Omit browser paths, query strings and account-console URLs." }],
  scopes, scopesForGrantType: (grantType) => scopes.filter((scope) => grantType === "client_credentials" ? scope.value !== "offline_access" : scope.value !== "jobs"),
  permissionsHint: "Permissions also depend on workspace membership and resource access. The jobs fragment only reads metadata; these OAuth scopes can permit more in other clients.",
  setup: { url: "https://docs.databricks.com/aws/en/integrations/enable-disable-oauth", steps: [
    "Enter the intended workspace's HTTPS origin in Workspace URL. Choose User consent for a custom OAuth application, or Service account for a service principal; these require different credentials.",
    "For User consent, an account admin opens account console > Settings > App connections > Add connection. Enter the app name and exact suggested callback, choose All APIs, generate a confidential client secret, set token lifetimes and add the connection. Copy the client ID and one-time secret. Activation can take 30 minutes.",
    "For Service account, an admin opens workspace user menu > Settings > Identity and access > Service principals > Manage. Select an assigned principal, open Secrets > Generate secret, set lifetime and the jobs scope, then Generate. Copy the displayed client ID and secret. Grant the principal workspace access and visibility of the required jobs. No callback is needed.",
    "Enter Client ID, save configuration, then use Set credential in Env to store the secret under the displayed Client secret reference. For User consent also use Set callback in Env to save the exact registered URL and keep offline access selected. For Service account choose permissions matching the secret; use jobs without all-apis for a jobs-scoped secret.",
    "Return here and check the connection. User consent opens Databricks authorization; service credentials need no browser consent. Verification reads a jobs page without running jobs or SQL. Empty results do not prove visibility of a particular job.",
    "A personal access token, login password or cloud-provider secret is not a Databricks OAuth secret. Check workspace assignment, job permissions, secret expiry and matching scopes if access fails. Rotate secrets in Env before retiring the old credential. Disconnect removes local state; it does not delete the principal or globally revoke the OAuth app."
  ] }
});
export { databricksDefinition };
