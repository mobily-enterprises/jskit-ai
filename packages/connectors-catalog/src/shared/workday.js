import { createSchema } from "json-rest-schema";

const host = "(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.){1,3}myworkday\\.com";
const restPattern = new RegExp(`^https://(?<host>${host})(?<prefix>/ccx)?/api/(?:v1|staffing/v7)/(?<tenant>[A-Za-z0-9_-]{1,128})/?$`, "u");
const authorizationPattern = new RegExp(`^https://${host}/(?<tenant>[A-Za-z0-9_-]{1,128})/authorize$`, "u");
const workdayRestEndpoint = (value) => typeof value === "string" ? restPattern.exec(value)?.groups : undefined;
const endpointField = { type: "string", required: true, noTrim: true, maxLength: 512 };

const workdayDefinition = Object.freeze({
  id: "workday", name: "Workday", description: "Read workers, organizations, time off and custom reports with each connected Workday user's permissions.",
  accountModes: ["per-user"], authenticationMethods: ["oauth2"],
  oauthClientAuthenticationMethods: ["client_secret_post", "client_secret_basic"],
  settingsSchema: createSchema({
    restApiEndpoint: { ...endpointField, validator: (value) => Boolean(workdayRestEndpoint(value)) ||
      "Copy the HTTPS Workday REST API endpoint ending /api/v1/tenant or /api/staffing/v7/tenant, with its /ccx prefix if present." },
    tokenEndpoint: { ...endpointField, validator: (value, settings) => {
      const rest = workdayRestEndpoint(settings.restApiEndpoint);
      return Boolean(rest && value === `https://${rest.host}/ccx/oauth2/${rest.tenant}/token`) ||
        "Copy the token endpoint for the same REST API host and tenant, ending /ccx/oauth2/tenant/token.";
    } },
    authorizationEndpoint: { ...endpointField, validator: (value, settings) => {
      const rest = workdayRestEndpoint(settings.restApiEndpoint);
      return Boolean(rest && authorizationPattern.exec(value)?.groups.tenant === rest.tenant) ||
        "Copy the HTTPS Workday authorization endpoint for the same tenant, ending /tenant/authorize. Its host may differ.";
    } }
  }),
  settingsFields: [
    { name: "restApiEndpoint", label: "Workday REST API Endpoint", placeholder: "https://wd5-services1.myworkday.com/ccx/api/v1/acme_corp",
      hint: "Copy from View API Clients. Worker reads use Staffing v7 on this host and tenant." },
    { name: "tokenEndpoint", label: "Token Endpoint", placeholder: "https://wd5-services1.myworkday.com/ccx/oauth2/acme_corp/token",
      hint: "Copy the Token Endpoint from the same Workday tenant." },
    { name: "authorizationEndpoint", label: "Authorization Endpoint", placeholder: "https://acme.wd5.myworkday.com/acme_corp/authorize",
      hint: "Copy from View API Clients. The sign-in host usually differs from the API host." }
  ],
  scopes: [],
  permissionsHint: "Select the required functional areas in Workday: Staffing, Organizations and Roles, or Time Off and Leave. Each user's domain and report permissions still apply. Connecting Workday does not create your app's login.",
  setup: { url: "https://docs.lovable.dev/integrations/workday", steps: [
    "In your Workday tenant, an administrator opens Register API Client and chooses Authorization Code Grant and Bearer access tokens.",
    "Register this confidential client without PKCE so Workday issues a Client Secret. Enter your application's exact backend callback URL.",
    "Select Staffing in Scope (Functional Areas). Grant intended users View access through the Report/Task permissions of the worker REST domains.",
    "For organization browsing, also select Organizations and Roles. Your tenant administrator must grant the intended users View: Supervisory Organization; member and org-chart reads need Reports: Organization. A successful worker check does not prove these permissions.",
    "For time-off balances and entries, select Time Off and Leave and grant the appropriate Self-Service or Worker Data: Time Off Report/Task permissions. Your app selects the worker and displays the returned units and status; this connection does not submit or approve leave.",
    "For custom reports, select Tenant Non-Configurable and Include Workday Owned Scope on the API client, plus the functional areas needed by the report's data. The report owner enables the report as a web service and shares it with the intended users. In the report's related actions, open Web Services, View URLs, fill required prompts and copy the JSON URL. Your app uses its owner/name and prompt aliases on the same configured tenant; verify report access separately.",
    "Save the Client ID and put the Client Secret in Env. Open View API Clients and copy the REST API, Token and Authorization endpoints into this form.",
    "Keep the tenant's approved refresh-token lifetime. An expired or revoked grant requires the user to reconnect.",
    "Each user connects their own Workday account inside your app. Every customer tenant needs its own registration and your app's callback. Disconnecting removes the app's saved grant; provider-side revocation is managed in Workday."
  ] }
});

export { workdayDefinition, workdayRestEndpoint };
