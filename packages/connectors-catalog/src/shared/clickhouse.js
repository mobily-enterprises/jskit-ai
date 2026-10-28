import { createSchema } from "json-rest-schema";
import { httpsSiteUrlField } from "./siteUrl.js";

const clickhouseDefinition = Object.freeze({
  id: "clickhouse", name: "ClickHouse", description: "jskit.connectors.clickhouse.description",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key", "none"], scopes: [],
  authenticationLabels: { "api-key": "jskit.connectors.clickhouse.authenticationLabels.apiKey", none: "jskit.connectors.clickhouse.authenticationLabels.none" },
  authenticationHint: "jskit.connectors.clickhouse.authenticationHint",
  apiKeySecretOptional: true,
  apiKeyReferenceLabel: "jskit.connectors.clickhouse.apiKeyReferenceLabel",
  apiKeyReferenceHint: "jskit.connectors.clickhouse.apiKeyReferenceHint",
  settingsSchema: createSchema({
    httpUrl: httpsSiteUrlField,
    username: { type: "string", minLength: 1, maxLength: 256,
      validator: (value) => !/[:\p{Cc}]/u.test(value) || "Enter a username without colons or control characters." }
  }),
  settingsFields: [
    { name: "httpUrl", label: "jskit.connectors.clickhouse.fields.httpUrl.label", placeholder: "https://service.example.clickhouse.cloud:8443",
      hint: "jskit.connectors.clickhouse.fields.httpUrl.hint" },
    { name: "username", label: "jskit.connectors.clickhouse.fields.username.label", placeholder: "default", authenticationMethods: ["api-key"],
      hint: "jskit.connectors.clickhouse.fields.username.hint" }
  ],
  setup: {
    url: "https://clickhouse.com/docs/products/cloud/guides/sql-console/connection-details",
    steps: [
      "Select the ClickHouse Cloud service and open Connect. Copy its HTTPS interface address and port into HTTP Interface URL, or obtain your self-hosted HTTPS query endpoint from its administrator. Native TCP addresses do not work here.",
      "Ask your database administrator for a dedicated application username and password with SELECT access to the intended tables. These are database credentials, not your Cloud console login or management API key.",
      "Choose Username and password, enter the database username, and enter env:CLICKHOUSE_PASSWORD in Password reference (optional). Save configuration, choose Set credential in Env, paste the password as CLICKHOUSE_PASSWORD and save it there. Leave the reference blank only for a database user deliberately configured with an empty password; an omitted username uses default.",
      "For a server deliberately allowing access without credentials, choose No credentials instead. This sends no authentication header and uses the server's default access. No password or Env reference is needed in this mode.",
      "For ClickHouse Cloud, open the service's Settings > Security > IP access list > Add IPs. Allow the application backend's source IP or CIDR and save. The browser's domain is not that source address; update the allowlist if the backend moves.",
      "Return here and choose Connect account or Verify again. Check connection only refreshes local status. Verification runs SELECT 1 and reads the database username; it does not prove permission to read every table. No OAuth registration or callback URL is needed.",
      "Analytical reads support SELECT/WITH queries with typed parameters, capped at 100 returned rows and 10 seconds. Use a dedicated read-only user with table grants and enforced scan, memory and network restrictions. An application must authorize the query and its tenant filters; accepting SQL text is not a sandbox. HTTP URLs and query parameters may appear in proxy logs, so configure log redaction.",
      "If verification fails, check the HTTPS endpoint, database credentials, network allowlist and the user's query-setting permissions described in the provider guide. To rotate access, update the database password and its Env value. Disconnect removes local connection state; it does not revoke the database user."
    ]
  }
});

export { clickhouseDefinition };
