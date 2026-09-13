import { createSchema } from "json-rest-schema";

const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const hostPattern = new RegExp(`^(?:semantic-layer\\.${label}\\.(?:getdbt|dbt)\\.com|${label}\\.semantic-layer\\.${label}\\.dbt\\.com)$`, "u");
const dbtSemanticLayerDefinition = Object.freeze({
  id: "dbt-semantic-layer", name: "dbt Semantic Layer", description: "Discover metrics and query their values in a dbt Semantic Layer environment.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  apiKeyReferenceLabel: "Service token reference",
  apiKeyReferenceHint: "Store the dbt service token in Env. It needs Semantic Layer Only and Metadata Only permissions and a linked warehouse credential.",
  settingsSchema: createSchema({
    host: { type: "string", required: true, maxLength: 253, validator: (value) => hostPattern.test(value) || "Enter the lowercase dbt Semantic Layer hostname without a URL, path or port." },
    environmentId: { type: "string", required: true, noTrim: true, maxLength: 38,
      validator: (value, object, context) => (typeof context.valueBeforeCast === "string" && /^[1-9][0-9]*$/u.test(value)) || "Enter a positive decimal Environment ID as text, without spaces or leading zeros." }
  }),
  settingsFields: [
    { name: "host", label: "Semantic Layer host", placeholder: "semantic-layer.cloud.getdbt.com",
      hint: "Copy the GraphQL hostname from dbt's Semantic Layer settings. Regional, single-tenant and multi-cell dbt hosts are supported." },
    { name: "environmentId", label: "Environment ID", placeholder: "70506183142324",
      hint: "The deployment environment containing your metrics. Keep the full ID as text to avoid rounding." }
  ],
  setup: { url: "https://docs.getdbt.com/docs/use-dbt-semantic-layer/setup-sl", steps: [
    "Open Account settings > Settings > Projects and select the project. In Project details, choose Semantic Layer > Configure Semantic Layer, select the deployment environment and Save. Metrics, a successful deployment run and a supported data platform must already exist.",
    "Under Credentials & service tokens, add a Semantic Layer credential with the required warehouse access.",
    "Choose Map new service token, name it for this application, select Semantic Layer Only and Metadata Only permissions, then Save. Copy the one-time token. If token creation is unavailable, ask your dbt administrator to create and link it.",
    "Return to Project details and copy the GraphQL hostname and Environment ID from the Semantic Layer connection details. Enter them here, preserving every ID digit. Enter env:DBT_SERVICE_TOKEN in Service token reference and save configuration. Choose Set credential in Env, paste the token as DBT_SERVICE_TOKEN and save it there.",
    "Return here and choose Connect account / Verify again. Check connection only reads saved status. Verification reads environment metadata; an explicitly wired application can then create metric queries and request their status and JSON result pages. If denied, check the host, environment, linked warehouse credential and token permissions. Replace the token through Env when rotating it; local Disconnect does not revoke it in dbt.",
    "Query execution uses your warehouse capacity. The app owns permitted metrics, trusted dimension/time filters and bounded polling. JSON results suit small tables; use dbt’s native Arrow tooling for large production workloads. Do not retry an uncertain query submission automatically. Configuring this connection does not attach dbt to Vibe64’s coding assistant.",
    "This token flow has no OAuth callback or app-user login. Public and Online need the customer's own account, permissions and capacity."
  ] }
});

export { dbtSemanticLayerDefinition };
