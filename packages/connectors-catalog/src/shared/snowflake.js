import { createSchema } from "json-rest-schema";

const rolePattern = /^[\x20-\x21\x23-\x5b\x5d-\x7e]{1,255}$/u;
function snowflakeRoleScope(role) {
  if (!role || !rolePattern.test(role)) return null;
  return /^[A-Za-z0-9_.~-]+$/u.test(role) ? `session:role:${role}`
    : `session:role-encoded:${encodeURIComponent(role).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
const snowflakeDefinition = Object.freeze({
  id: "snowflake", name: "Snowflake", description: "jskit.connectors.snowflake.description",
  accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
  oauthClientAuthenticationMethods: ["client_secret_post", "client_secret_basic"],
  settingsSchema: createSchema({
    warehouse: { type: "string", minLength: 1, maxLength: 255, noTrim: true },
    database: { type: "string", minLength: 1, maxLength: 255, noTrim: true },
    schema: { type: "string", minLength: 1, maxLength: 255, noTrim: true },
    accountUrl: { type: "string", required: true, maxLength: 253,
      validator: (value) => /^https:\/\/[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9-]*){0,3}\.snowflakecomputing\.com\/?$/u.test(value) ||
        "Enter the HTTPS Snowflake account URL, without a port, path, query or fragment." },
    role: { type: "string", minLength: 1, maxLength: 255,
      validator: (value) => rolePattern.test(value) && !["ACCOUNTADMIN", "SECURITYADMIN", "ORGADMIN", "GLOBALORGADMIN"].includes(value.toUpperCase()) ||
        "Use a non-administrator role name in ASCII, with exact case and without quotes or backslashes." }
  }),
  settingsFields: [
    { name: "warehouse", label: "jskit.connectors.snowflake.fields.warehouse.label", placeholder: "APP_WAREHOUSE",
      hint: "jskit.connectors.snowflake.fields.warehouse.hint" },
    { name: "database", label: "jskit.connectors.snowflake.fields.database.label", placeholder: "APP_DATABASE",
      hint: "jskit.connectors.snowflake.fields.database.hint" },
    { name: "schema", label: "jskit.connectors.snowflake.fields.schema.label", placeholder: "PUBLIC",
      hint: "jskit.connectors.snowflake.fields.schema.hint" },
    { name: "accountUrl", label: "jskit.connectors.snowflake.fields.accountUrl.label", placeholder: "https://myorg-myaccount.snowflakecomputing.com",
      hint: "jskit.connectors.snowflake.fields.accountUrl.hint" },
    { name: "role", label: "jskit.connectors.snowflake.fields.role.label", placeholder: "APP_READER",
      hint: "jskit.connectors.snowflake.fields.role.hint" }
  ],
  scopes: [{ value: "refresh_token", label: "jskit.connectors.snowflake.scopes.refreshToken.label", recommended: true, required: true }],
  scopesForSettings: ({ role } = {}) => [
    { value: "refresh_token", label: snowflakeRoleScope(role) ? "jskit.connectors.snowflake.scopes.refreshTokenOptional.label" : "jskit.connectors.snowflake.scopes.refreshToken.label", recommended: true, required: !snowflakeRoleScope(role) },
    ...(snowflakeRoleScope(role) ? [{ value: snowflakeRoleScope(role), label: { key: "jskit.connectors.snowflake.scopes.role.label", params: { role } }, recommended: true, required: true }] : [])
  ],
  permissionsHint: "jskit.connectors.snowflake.permissionsHint",
  setup: { url: "https://docs.snowflake.com/en/user-guide/oauth-custom", steps: [
    "Sign into the target account in Snowsight. Open account details and copy Account URL into this form. Do not use the browser's app.snowflake.com address. Each Snowflake account needs its own registration.",
    "Ask an administrator with CREATE INTEGRATION to open Projects → Worksheets → + → SQL Worksheet (or a SQL file in Workspaces). Use a new integration name; do not replace an existing production registration.",
    "Implement the application's callback first. Use its assigned hosting origin and actual backend callback path, save that full HTTPS URL in application Env, and enter its env: reference in Callback URL reference. Paste the same URL in the SQL below in place of YOUR_CALLBACK_URL.",
    "Run: CREATE SECURITY INTEGRATION APP_CONNECTOR TYPE = OAUTH ENABLED = TRUE OAUTH_CLIENT = CUSTOM OAUTH_CLIENT_TYPE = 'CONFIDENTIAL' OAUTH_REDIRECT_URI = 'YOUR_CALLBACK_URL' OAUTH_ENFORCE_PKCE = TRUE OAUTH_ISSUE_REFRESH_TOKENS = TRUE OAUTH_REFRESH_TOKEN_VALIDITY = 86400 OAUTH_USE_SECONDARY_ROLES = NONE;",
    "Run SELECT SYSTEM$SHOW_OAUTH_CLIENT_SECRETS('APP_CONNECTOR'); Copy OAUTH_CLIENT_ID to Client ID. Save one returned client secret in application Env and enter only its env: reference in Client secret reference. Keep this query result out of source files, logs and chat.",
    "Have the administrator grant the intended user a dedicated role and enter its exact name in Role. Blank uses that user's default role. ACCOUNTADMIN, SECURITYADMIN, ORGADMIN and GLOBALORGADMIN are excluded. OAuth registration privileges do not grant access to data.",
    "For SQL, enter exact Warehouse, Database and Schema names from Snowsight or your administrator, without surrounding quotes. The role needs USAGE on the warehouse, database and schema plus SELECT on intended tables for reads, or the applicable write grants. These fields are defaults, not an access boundary.",
    "Warehouse management needs separate grants: CREATE WAREHOUSE on the account to create, MODIFY to resize, OPERATE to resume/suspend, and OWNERSHIP to drop. Keep these out of reader roles. Resume, resize and query execution can incur Snowflake charges. New warehouses created by this connector start suspended with auto-resume disabled.",
    "Save and connect the intended account. Per-user consent happens in the generated application's account screen. Verification lists visible databases: an empty successful list does not prove SQL access. Test an approved small query through your application; it owns query and warehouse permissions, polling and cancellation.",
    "If consent expires or is revoked, reconnect. After a domain change, update OAUTH_REDIRECT_URI on the security integration and the application's callback Env together. Disconnect removes this application's stored connection; revoke delegated authorization in Snowflake separately when needed."
  ] }
});
export { snowflakeDefinition, snowflakeRoleScope };
