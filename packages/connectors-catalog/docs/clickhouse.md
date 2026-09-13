# ClickHouse

Import `clickhouseProvider` from `@jskit-ai/connectors-catalog/server/clickhouse`.
This fragment verifies an HTTPS database endpoint, discovers tables and columns,
and reads bounded pages. The application owns access to this shared database.
A database connection does not sign users into the application.

## Manual setup

1. In ClickHouse Cloud, select your organization and service, then choose
   **Connect → HTTPS**. Copy the host and port from its connection example.
   Put the full `https://host:port` address in **HTTP Interface URL**. For a
   self-hosted server, obtain its HTTPS query endpoint from its administrator;
   a reverse-proxy path is supported. Native TCP connection strings do not work.
   [Connection details](https://clickhouse.com/docs/products/cloud/guides/sql-console/connection-details).
2. Open the service's **SQL Console**, create a query using **+**, and have a
   database administrator create a dedicated application user and grant SELECT
   only on the intended tables. Use SQL `CREATE USER` and `GRANT SELECT`, with a
   private password supplied through your administration process. Cloud console
   accounts and database users are separate. Do not place a Cloud management
   API key in this integration's password field.
   [SQL Console](https://clickhouse.com/docs/products/cloud/features/sql-console-features/sql-console),
   [database users and permissions](https://clickhouse.com/docs/concepts/features/security/access-rights).
3. Select **Settings → Security → IP access list → Add IPs** for the service.
   Choose access from specific locations, add the application backend's source
   IP/CIDR and save. Include an administrator's authorized access path when
   needed. Requests originate from the server running this adapter; the
   application's browser domain is not the source IP.
   [IP filters](https://clickhouse.com/docs/products/cloud/guides/security/connectivity/setting-ip-filters).
4. Select **Username and password** in the integration form. Enter the database
   username. Enter `env:CLICKHOUSE_PASSWORD` in **Password reference
   (optional)**, then save configuration. Choose **Set credential in Env**, paste
   the password as `CLICKHOUSE_PASSWORD`, and save it there. CLI users set the
   same variable in their backend environment. The form stores a reference, not the
   password. The backend resolves it when verifying and reading.
5. Verify using `connectApiKey` as shown below, then exercise the particular
   table operation your application needs. A successful `SELECT 1` proves
   endpoint access, not permission to read every table.

The database administrator must allow the adapter's fixed query settings:
`max_execution_time=10`, `max_result_rows=100`, `max_result_bytes=5242880`, and
`result_overflow_mode=throw`. A user profile that forbids these settings will
reject the request; the adapter does not retry without bounds. Configure
compatible settings constraints for a user with `readonly=1`.
[Query permissions](https://clickhouse.com/docs/concepts/features/configuration/settings/permissions-for-queries).

## Credential choices

| Configuration | HTTP behavior |
|---|---|
| `api-key`, username and password reference | Basic authentication with that database user and resolved password |
| `api-key`, username omitted | Basic authentication as `default` |
| `api-key`, password reference omitted | Basic authentication with an empty password |
| `api-key`, reference resolves to an empty string | An explicitly configured empty password |
| `api-key`, reference missing or invalid | Local binding error; no database request |
| `none` | No Authorization header and no credential resolution |

Use **No credentials** only for an endpoint intentionally configured to permit
that access. ClickHouse otherwise uses its default user and an empty password;
the database's permissions still apply. Switching modes clears the username and
password reference that no longer apply. Both modes require verification and
the application's ordinary authorization policy.
[HTTP authentication](https://clickhouse.com/docs/concepts/features/interfaces/http#authentication).

## Portable configuration and CLI wiring

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "warehouse": {
      "provider": "clickhouse",
      "displayName": "Reporting database",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:CLICKHOUSE_PASSWORD"
      },
      "settings": {
        "httpUrl": "https://warehouse.example:8443/",
        "username": "report_reader"
      }
    }
  }
}
```

Compose the [API-key source pattern](../patterns/api-key-connection/PATTERN.md)
with `providers: [clickhouseProvider]`. Use `createFileConnectionStore` for
encrypted JSON runtime state outside source. The CLI and editor use the same
parser, fields and runtime; no application generator or local SQL store is
needed. Supply authenticated application context and its authorization policy.

```js
await connections.connectApiKey({ context, integrationId: "warehouse" });
const tables = await connections.invoke({
  context, integrationId: "warehouse", operation: "tables.list",
  input: { database: "reports", limit: 20 }
});
const columns = await connections.invoke({
  context, integrationId: "warehouse", operation: "columns.list",
  input: { database: "reports", table: "orders" }
});
const rows = await connections.invoke({
  context, integrationId: "warehouse", operation: "rows.list",
  input: { database: "reports", table: "orders", orderBy: "id", limit: 25, offset: 0 }
});
```

For no credentials, replace authentication with `{ "method": "none" }`, remove
`settings.username`, and use `connectWithoutCredentials` instead of
`connectApiKey`. The remaining configuration and invocation APIs are identical.
An existing grant cannot survive a change of mode, endpoint, username or
password reference without verification. Rotating the environment value takes
effect on the next call. Disconnect removes local state; revoke the database
user or change its password separately when appropriate.

## Operations and result handling

| Operation | Inputs | Result |
|---|---|---|
| `connection.check` | None | `SELECT 1 AS ok, currentUser() AS user` |
| `tables.list` | Optional database; limit, offset | Database, table name and engine from `system.tables` |
| `columns.list` | Database and table; limit, offset | Column type, position and default metadata from `system.columns` |
| `rows.list` | Database and table; optional orderBy; limit, offset | One page of table rows |
| `queries.read` | SELECT/WITH SQL and optional named string parameters | Bounded analytical result with column metadata/statistics |

Names are nonempty strings of up to 256 characters without control characters.
Table/database names and the optional ascending sort column use ClickHouse
typed parameters, including `Identifier`; they are never inserted into SQL
text. Quotes, dots and backslashes remain parameter values. `orderBy` denotes
one column name, not an expression. The discovery operations use fixed SELECT queries. `queries.read` accepts an
application-approved SELECT/WITH query; endpoint and HTTP setting overrides are
not accepted as operation inputs.
[Typed parameters](https://clickhouse.com/docs/reference/syntax#defining-and-using-query-parameters).

For analytical queries, use a backend-owned template and typed placeholders:

```js
await connections.invoke({ context, integrationId: "warehouse", operation: "queries.read",
  input: { sql: "SELECT toStartOfMonth(booked_at) AS month, count() AS bookings FROM {db:Identifier}.{table:Identifier} WHERE tenant = {tenant:String} GROUP BY month ORDER BY month LIMIT 100",
    parameters: { db: "reports", table: "bookings", tenant: authorizedTenantId }
  } });
```

The operation accepts one SELECT/WITH query, up to 16,000 characters, without a
semicolon or trailing FORMAT clause (the adapter appends FORMAT JSON). Up to 100
parameters use identifier names and string values up to 16,000 characters, without
control characters. Encode numeric/date values as strings for their declared
ClickHouse types. Parameter values stay separate from SQL; they cannot override
HTTP settings. Arrays/complex values require ClickHouse's typed literal syntax.

This is **not a SQL sandbox**. The initial keyword check is input guidance, not a
security boundary. Database grants, read-only profiles, row policies and server
setting constraints must enforce permitted reads, tenant isolation and resource
budgets. SELECT can access table functions or external sources where the database
allows them. Prefer fixed approved templates; never let an untrusted frontend
choose arbitrary queries/table functions or omit its required tenant filter.
Read-only HTTP and result bounds do not make arbitrary SQL safe or inexpensive.
SQL and parameter values are in the request URL; redact proxy/access logs.
Other frameworks use the same HTTPS endpoint and typed `param_name` contract with
their native HTTP/database tools, and read the same Env/configuration values.

Limit is 1–100, default 20; offset is 0–1000000, default 0. Calls never fetch
another page automatically. Offset paging can repeat or skip rows as data
changes. Rows have no guaranteed ordering without `orderBy`; even with it,
choose a stable unique column for predictable paging. A small result limit
does not guarantee a cheap scan or sort. The database administrator owns scan,
memory, thread and quota constraints.

The adapter returns the parsed `FORMAT JSON` envelope unchanged: `meta`, `data`,
`rows` and any provider statistics. It accepts empty pages and validates the
envelope before success. It does not convert strings into numbers or dates;
preserve large integer strings and consult `meta` for column types. Provider
format settings determine decimal/large-number encoding, so do not assume
JavaScript numbers can represent every value exactly.
[JSON format](https://clickhouse.com/docs/reference/formats/JSON/JSON).

Requests ask for response buffering with `wait_end_of_query=1`. ClickHouse can
still report an execution exception after sending HTTP 200; incomplete JSON or
an exception envelope is an error, never a successful partial page. HTTP errors
and timeouts are surfaced without replay. Cancellation ends the local request;
it does not prove the database query stopped. The fixed execution-time setting
limits server work, subject to ClickHouse's execution checks.
[HTTP buffering and error behavior](https://clickhouse.com/docs/concepts/features/interfaces/http).

The configured endpoint may be private and may include a port or proxy path.
Validation rejects HTTP, embedded credentials, queries, fragments and parent
path segments. It does not resolve DNS or impose network policy. The host must
restrict configuration editing and its backend's network access. Redirects are
rejected; credentials never go in the URL or browser configuration.

## Automation and Online ownership

An AI can prepare portable JSON and wire the library. With an authorized
database administrator connection, it can provision users, grants, profiles and
quotas using SQL. A self-hosted administrator can also use ClickHouse access
configuration files. These are separate administrative operations; this adapter
does not execute them.

Cloud service provisioning is also programmable using ClickHouse's management
API. An organization operator first opens **API Keys → New API Key**, sets the
name, roles, expiration and allowed IPs, and chooses **Generate API Key**.
Store the displayed Key ID/secret privately. Authorized automation can then use
the API with those management credentials. Account setup, billing access and
required administrative permission remain operator responsibilities. Management
credentials belong to provisioning, not the application's database connection.
[Cloud API keys](https://clickhouse.com/docs/products/cloud/features/admin-features/api/openapi).

**Universal callback: not applicable.** This mode has no OAuth registration or
provider redirect. Each customer supplies their database endpoint and access.
An editor VM or app custom-domain change needs no new callback. If backend
egress changes, update the database IP allowlist. If the database URL changes,
update `httpUrl` and verify again.

The database owner can create separate application users with distinct grants and
quota profiles. Two usernames alone do not isolate CPU, memory or storage;
independent capacity requires appropriate budgets or separate compute. Each
application stores its own credential in private Env and enforces its access and
network policy. The [application setup contract](../../connectors-core/docs/online-setup.md)
also applies when the application moves hosts.

## Focused proof and remaining work

Tests use controlled HTTP and real encrypted temporary files. They cover Basic
and no-credential modes, default users, empty/missing passwords, rotation,
restart, isolation, changed bindings, typed query parameters, page bounds,
malformed replies, HTTP-200 exceptions, errors and cancellation without replay.
The shared form tests cover mode changes, hidden-field removal, locking, CLI
import and remount at 390, 820 and 1440 pixels. Public-editor cases cover phone
and desktop file persistence. These checks do not execute SQL on a live server.

**LIMITATIONS:** Automatic Vibe64 coding-assistant attachment remains deferred.
For example, the app can show monthly booking totals through `queries.read`, but
saving this configuration does not enable Vibe64 chat to query that database.
Writes, database provisioning/administration and per-user database identity
management remain native work; use an administrator outside this connector to
create a reporting user and its row/resource policies. There is no query-builder
canvas or SQL sandbox. Controlled query tests exercise both credential modes;
no live SQL service, provisioning or generated application is claimed.
