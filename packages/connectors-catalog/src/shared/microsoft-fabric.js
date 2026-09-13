import { createSchema } from "json-rest-schema";

const delegatedScope = "https://analysis.windows.net/powerbi/api/GraphQLApi.Execute.All";
const serviceScope = "https://api.fabric.microsoft.com/.default";
const guid = "[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}";
const guidPattern = new RegExp(`^${guid}$`, "u");
const endpointPattern = new RegExp(`^https://api\\.fabric\\.microsoft\\.com/v1/workspaces/${guid}/(?:graphqlapis|graphQLApis|GraphQLApis)/${guid}/graphql$`, "u");
const scopes = [
  { value: delegatedScope, label: "Execute GraphQL queries and mutations as the user", recommended: true },
  { value: "offline_access", label: "Keep user access between visits", recommended: true },
  { value: serviceScope, label: "Use the service account's Fabric permissions", recommended: true }
];

const microsoftFabricDefinition = Object.freeze({
  id: "microsoft-fabric", name: "Microsoft Fabric", categories: ["Microsoft", "Productivity"],
  description: "Access one Fabric GraphQL API using user consent or a service principal.",
  accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
  oauthGrantTypes: ["authorization_code", "client_credentials"], oauthClientAuthenticationMethods: ["client_secret_post"],
  validateClientId: (value) => guidPattern.test(value) || "Enter the Application (client) ID as a GUID.",
  oauthGrantHint: "User consent needs a Web callback and delegated GraphQL permission. Service account needs a service principal with Fabric access, without a callback.",
  settingsSchema: createSchema({
    tenantId: { type: "string", required: true, maxLength: 36,
      validator: (value) => guidPattern.test(value) || "Enter the Directory (tenant) ID as a GUID, not common or a client ID." },
    graphqlEndpoint: { type: "string", required: true, maxLength: 256,
      validator: (value) => endpointPattern.test(value) || "Copy the Fabric GraphQL API endpoint with workspace and API IDs, without a query string or fragment." }
  }),
  settingsFields: [
    { name: "tenantId", label: "Microsoft Entra Tenant ID", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", hint: "The directory containing the Fabric resource and permitted users or service principal." },
    { name: "graphqlEndpoint", label: "Fabric GraphQL Endpoint", placeholder: "https://api.fabric.microsoft.com/v1/workspaces/<workspace-id>/graphqlapis/<api-id>/graphql",
      hint: "Open your API for GraphQL in Fabric and select Copy endpoint. Custom proxies and sovereign-cloud addresses are not supported by this fragment." }
  ],
  scopes, scopesForGrantType: (grantType) => scopes.filter((scope) => grantType === "client_credentials" ? scope.value === serviceScope : scope.value !== serviceScope),
  permissionsHint: "Fabric Execute access permits queries and mutations. Your application must authorize the documents it executes. Data-source access is separate; this does not sign users into your application.",
  setup: { url: "https://learn.microsoft.com/en-us/fabric/data-engineering/connect-apps-api-graphql", steps: [
    "You need an existing Fabric API for GraphQL and permission to register an application in its Microsoft Entra directory. In Entra admin center → Entra ID → App registrations → New registration, name the app, choose the intended directory audience and Register. Copy Application (client) ID and Directory (tenant) ID from Overview into their separate fields; use the tenant GUID, not common.",
    "Open Certificates & secrets → Client secrets → New client secret. Add a description and expiry, then Add. Copy Value immediately, not Secret ID. Keep env:MICROSOFT_FABRIC_CLIENT_SECRET as the secret reference; store the secret value in Env after saving.",
    "For User consent, open Authentication → Redirect URI configuration → Add Redirect URI → Web, paste this project's exact Suggested callback URL and Configure. Under API permissions → Add a permission → Power BI Service → Delegated permissions, select GraphQLApi.Execute.All. Allow offline access for refresh and complete any administrator consent required by the directory.",
    "For Service account, no callback or delegated permission is needed. A Fabric tenant administrator opens Admin portal → Tenant settings → Developer settings, enables Service principals can use Fabric APIs and selects Apply. In the API item's … → Manage permissions → Add user, find the app registration, select Run Queries and Mutations and Grant.",
    "Open the existing API for GraphQL and select Copy endpoint. Paste the complete URL into Fabric GraphQL Endpoint. The signed-in user or service principal needs API Execute access; the caller or saved connection also needs underlying data-source permissions. These are separate grants.",
    "Save configuration, then use Set credential in Env for the secret. User consent also needs Open Env to store the exact registered URL as MICROSOFT_FABRIC_CALLBACK_URL. Connect account uses the selected shared identity; per-user connections happen inside the generated app. Service account connects without a browser consent window.",
    "Use graphql.execute with an app-approved query, JSON variables and optional operationName. It accepts mutations too: authorize the exact document and inputs on your backend. Partial GraphQL errors fail the call and may follow a successful change; inspect data before retrying.",
    "LIMITATIONS: no automatic table browser, schema-specific client, pagination, subscriptions or Vibe64 assistant attachment. Example: query your inventory with its actual schema, but do not expect a generated inventory dashboard or an unrestricted query console.",
    "Verification reads only the root type name; it does not test your business queries or mutate data. For optional schema discovery, a workspace administrator enables Introspection in the API settings. Rotate expiring secrets in Env before deleting old ones. Disconnect removes local access, not Fabric permissions or Microsoft consent."
  ] }
});

export { microsoftFabricDefinition, delegatedScope, serviceScope };
