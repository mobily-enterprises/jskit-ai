# Snowflake

The initial `snowflakeProvider` connects a custom Snowflake OAuth client and
lists database metadata. JSKIT owns the configuration, field metadata, OAuth
exchange, refresh and file-backed connection state. The application supplies
its authenticated ownership policy and secret-reference resolver. The editor
stores the same JSON a CLI user writes. Saving configuration contacts no provider.

## Configuration

```json
{
  "schemaVersion": 1,
  "registrations": {
    "snowflake": {
      "source": "own",
      "clientId": "client-id-from-your-security-integration",
      "clientSecretRef": "env:SNOWFLAKE_SECRET",
      "callbackUrlRef": "env:SNOWFLAKE_CALLBACK"
    }
  },
  "integrations": {
    "warehouse": {
      "provider": "snowflake",
      "accountMode": "per-user",
      "settings": {
        "accountUrl": "https://myorg-myaccount.snowflakecomputing.com",
        "role": "VIBE64_READER"
      },
      "scopes": ["refresh_token", "session:role:VIBE64_READER"],
      "authentication": { "method": "oauth2", "registrationRef": "snowflake" }
    }
  }
}
```

`shared` uses one grant under the application's shared owner; `assistant` uses
the assistant owner's grant; `per-user` keeps each user's grant separate. The
host must authorize those owners. None of these modes implements application
login or automatically grants workspace members access.

Set `SNOWFLAKE_SECRET` in the host's established secret store and
`SNOWFLAKE_CALLBACK` to the exact route handled by the backend. Values stay out
of this file. `client_secret_post` is the default. To use HTTP Basic, explicitly
set registration `tokenEndpointAuthMethod` to `client_secret_basic`.

The account URL accepts HTTPS account-name, locator/region and PrivateLink
addresses under `snowflakecomputing.com`, with an optional trailing slash.
Use the address reported by the account; paths, credentials, ports and query
strings are rejected. PrivateLink also needs reachable private DNS/networking;
validation does not create that connectivity. See [account URL formats](https://docs.snowflake.com/en/user-guide/organizations-connect).

Role is optional in this initial form for every ownership mode. For a shared
connection, assign a dedicated role. Use exact case from `SHOW ROLES`, without
surrounding quotes. This fragment accepts ASCII names up to 255 characters,
excluding double quotes/backslashes and the four privileged administrator
roles. Spaces and punctuation use Snowflake's encoded role scope. Non-ASCII
role names are not implemented. The UI updates the required role permission
when the role changes; CLI users must update `scopes` too.

For the default user role, omit `settings.role` and use `["refresh_token"]`.
For a named role, refresh permission is optional and the role permission is
required. The current shared schema requires at least one permission, so the
blank-role form keeps refresh selected. A user who declines offline access can
still connect, but must reconnect after the access token expires. Changing the
account or role invalidates saved access and pending consent.

## Create the provider registration

1. Sign into the target account in Snowsight. Open the account menu/details and
   copy its **Account URL**, rather than the current browser address. Confirm
   the account before continuing.
2. Select an administrator role with `CREATE INTEGRATION`. Open **Projects →
   Worksheets**, choose **+ → SQL Worksheet**, or open an existing SQL worksheet.
   In accounts using the newer Workspaces navigation, create a SQL file there.
   The SQL operations below are the stable setup contract when labels differ.
3. Have the account administrator choose or create a dedicated reader role,
   grant it the necessary database visibility, and grant it to intended users.
   Registration permission and data access are separate. The runtime's first
   read can succeed with an empty list; that does not prove table access.
4. Edit the following SQL with the real callback and approved role. Execute it
   in that account. Use a fresh integration name; do not replace an existing
   production integration as a shortcut.

```sql
CREATE SECURITY INTEGRATION DOGANDGROOM_READER
  TYPE = OAUTH
  ENABLED = TRUE
  OAUTH_CLIENT = CUSTOM
  OAUTH_CLIENT_TYPE = 'CONFIDENTIAL'
  OAUTH_REDIRECT_URI = 'https://your-app.example/integrations/snowflake/callback'
  OAUTH_ENFORCE_PKCE = TRUE
  OAUTH_ISSUE_REFRESH_TOKENS = TRUE
  OAUTH_REFRESH_TOKEN_VALIDITY = 86400
  OAUTH_USE_SECONDARY_ROLES = NONE;

DESC SECURITY INTEGRATION DOGANDGROOM_READER;
SELECT SYSTEM$SHOW_OAUTH_CLIENT_SECRETS('DOGANDGROOM_READER');
```

5. Copy `OAUTH_CLIENT_ID` into **Client ID**. Save one returned client secret in
   the host's secret store and enter only its reference in **Client secret
   reference**. Treat the SQL result as secret material; do not paste it into
   AI chat, source files or logs. Confirm the allowed OAuth endpoints in the
   `DESC` result match the account URL.
6. Enter **Account URL**, optional **Role**, **Callback URL reference** and
   ownership in the editor, or write the JSON above. Configure the callback
   handler before starting consent. Use the system browser, select the intended
   Snowflake user and approve the requested role/offline access.
7. Verify using `databases.list`, then inspect an intentionally small page.
   Lack of database visibility requires changing Snowflake grants, not changing
   the app user's identity or requesting administrator roles.

The callback above is an illustrative placeholder. Substitute the application's
actual implemented backend callback before running the SQL. For local HTTP loopback development, Snowflake additionally needs
`OAUTH_ALLOW_NON_TLS_REDIRECT_URI = TRUE`; use a separate development integration.
Keep production HTTPS. PKCE is supported with confidential clients. See the
[registration SQL reference](https://docs.snowflake.com/en/sql-reference/sql/create-security-integration-oauth-snowflake).

## Connection ownership and callbacks

Register the real callback implemented by the runtime that owns this connection.
For an application integration, use the application's assigned hosting URL as
the initial origin and its implemented callback path. Store the exact callback
in its Env reference and provider registration. A domain change requires updating
both values if the callback URL changes; retain the application identity and its
persistent grants when moving hosts. Public Vibe64, Online and CLI users supply
their own registrations through this same contract.
See the [callback guide](../../connectors-core/docs/oauth-callbacks.md).

A Snowflake security integration belongs to one Snowflake account. Separate
security integrations produce independent client credentials; they do not split
that account's compute costs or guarantee independent provider quotas. Another
customer's account needs its own integration. A single registration cannot
unlock arbitrary accounts. Store each application's client secret in private Env.
Snowflake's `PUBLIC` client type is a separate credential mode; that native
public-client flow is not included by this confidential-client adapter.

## What AI can automate

With an already authorized administrator connection, AI can prepare and execute
registration SQL using Snowflake CLI or the SQL API, inspect integration
properties and configure the application's registration in its account. An operator must
approve the account, roles, network policy and callback ownership and arrange
secret capture directly into the secret store. Account enrollment, administrator
access and user consent are not supplied by this adapter. There is no named OAuth-registration provisioning operation. General statement
submission can execute only SQL permitted by the configured Snowflake role and
application policy; do not grant registration administration to an ordinary
application reader.

For manual work use the worksheet steps above. For CLI work use the same SQL
and portable configuration; there is no separate editor-only format. The host
owns provisioning authority, not an implicitly elevated runtime OAuth grant.

## Runtime contract and limits

Import `snowflakeProvider` from `@jskit-ai/connectors-catalog/server/snowflake` and
register it with `createConnectionService`. Call `beginAuthorization`, return the
provider callback to `completeAuthorization`, and invoke `databases.list` through
the authenticated application's owner context. See the packaged OAuth AI pattern
and `@jskit-ai/connectors-core` guide for file-store and resolver wiring.

The reader makes `GET /api/v2/databases`. It accepts `showLimit` (1–1000, default
20; an adapter cap), optional `like`, `startsWith`, `fromName` (1–255 characters)
and `history` (default false). It returns the provider's array of database
records. Request the next page explicitly with the last name as `fromName` and
the same filters; there is no background crawl or arbitrary continuation URL.
See the [Database API reference](https://docs.snowflake.com/en/developer-guide/snowflake-rest-api/reference/database)
and its [OpenAPI response schema](https://github.com/snowflakedb/snowflake-rest-api-specs/blob/main/specifications/database.yaml).

Each request uses an OAuth bearer token, token-type header and, when configured,
an exact quoted role header. Snowflake enforces the token's permitted role;
a caller cannot override it through operation input. See [REST authentication](https://docs.snowflake.com/en/developer-guide/snowflake-rest-api/authentication)
and [role context](https://docs.snowflake.com/en/developer-guide/snowflake-rest-api/setting-context).

OAuth uses the account's `/oauth/authorize` and `/oauth/token-request`, state and
S256 PKCE. The callback must contain an unambiguous scope value. Token lifetimes
and optional refresh fields are validated; refresh rotations are stored before
subsequent reads. Missing refresh or revoked grants require reconnecting.
See [Snowflake's custom OAuth flow](https://docs.snowflake.com/en/user-guide/oauth-custom).

The reader validates completed JSON pages, rejects oversized/malformed results
and fails explicitly on HTTP 202 rather than treating pending work as success.
This restriction applies to database listing; SQL operations below explicitly
handle pending responses. External OAuth, key-pair/PAT mode and provider
revocation are not implemented. Disconnect removes local state; revoke delegated authorization in
Snowflake separately when required. Errors are sanitized; cancellation and
timeouts are bounded. Automated tests use controlled protocol fixtures only.


## SQL context

Optional `settings.warehouse`, `settings.database` and `settings.schema` retain
exact case-sensitive names in portable configuration. Snowflake uses the connected
user's defaults when these are omitted. These defaults are not an access-control
boundary; the user's role grants remain authoritative. Statement submission, polling, partition retrieval and cancellation now exist;
warehouse actions also use that lifecycle. The application explicitly invokes each operation.

Find the warehouse in Snowsight's warehouse administration and database/schema
names in its database explorer, or ask the account administrator for the exact
names. The role needs warehouse USAGE and applicable database/schema/object
permissions. Query execution may resume a suspended warehouse and incur compute
charges; no live execution is part of implementation verification.

Use `statements.submit({ statement, requestId, bindings?, timeout? })` for a
single parameterized statement. The UUID request ID is explicit; timeout defaults
to 60 seconds and is bounded to 1–3600. Numbered bindings carry a Snowflake type
and string/null value, preserving numeric precision. The operation uses configured
warehouse/database/schema/role, sets single-statement mode and requests async
execution. It returns pending/completed with a handle.

Use `statements.get({ handle, partition? })` to poll or read one result partition.
Completed results retain `data` as string/null rows and `metadata` when supplied;
retain the first partition’s row types when subsequent partitions omit metadata.
Use `statements.cancel({ handle })` to explicitly cancel. Requests construct the
account URL from configuration; returned status links are never followed. The application owns operation authorization,
query selection, polling and uncertain-request recovery. Multi-statement execution
and raw end-user SQL must not be silently enabled.

[Snowflake SQL API contract](https://docs.snowflake.com/en/developer-guide/sql-api/reference).


The application must authorize the statement text and handle before invocation.
Do not expose arbitrary SQL to untrusted visitors. Namespace settings are defaults,
not a SQL sandbox; fully qualified SQL can name any resource the Snowflake role
can access. Keep grants narrow and maintain application ownership of handles.
A transport timeout is not proof the query stopped. Keep the request ID, consult
Snowflake query history and reconcile before submitting another mutation; this
adapter never retries submission automatically. Controlled tests cover asynchronous rejection, malformed results and uncertain
submission without replay. Live provider execution remains untested.


## Warehouse actions

`warehouses.create({ name, size, requestId })` creates a standard warehouse,
initially suspended, with auto-resume disabled and 60-second auto-suspend.
`warehouses.resize({ name, size, requestId })` changes its size. Accepted sizes
are XSMALL, SMALL, MEDIUM, LARGE, XLARGE, XXLARGE, XXXLARGE, X4LARGE, X5LARGE
and X6LARGE; availability depends on the account.

`warehouses.resume`, `warehouses.suspend` and `warehouses.delete` each accept
`{ name, requestId }`. Names are exact case-sensitive identifiers, quoted by
the adapter; do not enter surrounding SQL quotes. Each action returns the same
pending/completed handle result as SQL submission. Poll through statements.get.
The application must authorize the named warehouse and action, present billing
implications before resume/resize, and confirm deletion. Role grants are enforced
by Snowflake. Creation does not replace an existing warehouse; deletion is explicit.
These helpers do not manage multi-cluster scaling, resource monitors or grants.

See [CREATE WAREHOUSE](https://docs.snowflake.com/en/sql-reference/sql/create-warehouse),
[ALTER WAREHOUSE](https://docs.snowflake.com/en/sql-reference/sql/alter-warehouse)
and [DROP WAREHOUSE](https://docs.snowflake.com/en/sql-reference/sql/drop-warehouse).

Responses are read with a 16 MiB limit before JSON parsing. A larger partition
returns connector_response_too_large; reduce the query projection/result or use
Snowflake's native streaming facilities in the chosen framework. SQL is not
resubmitted on that error. Keep the handle to reconcile existing execution.

Controlled source and installed-package verification each pass 17 focused tests,
including interrupted oversized response streams and application resource policy.
Expanded configuration and compact configuration/lifecycle checks pass, including
SQL-default persistence, rendered setup instructions and consent cancellation/
disconnect. No live account, SQL compute or generated application was exercised.


For another framework, use its native OAuth client and Snowflake SQL client with
the same account URL, callback Env, exact role and namespace defaults. Implement
the confidential-client/PKCE consent and refresh lifecycle there; JSKIT is not a
remote service. Preserve string-valued numeric results, one explicit statement
request ID, partition polling and cancellation. Apply the same application
policy to SQL text, handles and warehouse names before invoking the provider.
