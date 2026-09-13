# dbt Semantic Layer

Import `dbtSemanticLayerProvider` from
`@jskit-ai/connectors-catalog/server/dbt-semantic-layer`. The library verifies an environment, browses metadata and queries metric values. CLI and Vibe64 use the
same file and validators. Saving does not contact dbt or run a warehouse query.

## Provider setup

1. Sign into the dbt account owning the project. Confirm Semantic Layer access,
   configured metrics, a supported warehouse and a deployment environment.
2. Open **Account settings → Settings → Projects**, select your project, then
   **Semantic Layer → Configure Semantic Layer**. Choose the deployment
   environment containing those metrics and save.
3. Under **Credentials & service tokens**, choose **Add Semantic Layer
   credential**. Supply a warehouse identity allowed to read the source schemas.
4. Map a new service token to that credential. Name it for this application and
   grant **Semantic Layer Only** and **Metadata Only** permissions. Save.
5. Copy the one-time token. In Vibe64 enter `env:DBT_SERVICE_TOKEN` in
   **Service token reference**, save configuration, and use **Set credential in
   Env** to paste and save the token as `DBT_SERVICE_TOKEN`. CLI users supply the
   same backend environment variable; source stores only its reference.
6. Copy the GraphQL hostname and Environment ID from the Semantic Layer
   connection details. Use the GraphQL host, not the JDBC connection string.
7. Save and choose **Connect account / Verify again**. **Check connection** only reads saved status. CLI hosts call `connectApiKey`.
   Verification reads the environment's data-platform dialect.

The provider's account plan, roles and warehouse credentials remain required.
[Semantic Layer setup](https://docs.getdbt.com/docs/use-dbt-semantic-layer/setup-sl)

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "metrics": {
      "provider": "dbt-semantic-layer",
      "displayName": "Warehouse metadata",
      "accountMode": "shared",
      "scopes": [],
      "settings": {
        "host": "semantic-layer.cloud.getdbt.com",
        "environmentId": "70506183142324"
      },
      "authentication": {
        "method": "api-key",
        "secretRef": "env:DBT_SERVICE_TOKEN"
      }
    }
  }
}
```

The Environment ID is positive decimal **text**, locally bounded to 38 digits.
Never convert it through a JavaScript number. `assistant` ownership is also
available; neither mode connects separate accounts for application users.

## Hosts and operations

The transport sends Bearer-authenticated POST requests to
`https://<host>/api/graphql`, injecting the configured `environmentId` as a
`BigInt!` variable. Hosts support North America, EMEA, APAC, dbt single-tenant
and multi-cell patterns. Copy the actual hostname; these patterns do not prove
that a particular account exists. Arbitrary domains, URLs, paths and ports are
rejected. [GraphQL API](https://docs.getdbt.com/docs/dbt-apis/sl-graphql)

| Operation | Inputs | Selected result |
|---|---|---|
| `queries.create` | `metrics`, optional `groupBy` and `where`, `limit` (default 100, max 10000) | `data.createQuery.queryId` |
| `queries.get` | `queryId`, `pageNum` (default 1) | `data.query.status`, `totalPages`, decoded `jsonResult` |
| `environment.read` (verification) | None | `data.environmentInfo.dialect` |
| `metrics.list` | Paging and optional search | `data.metricsPaginated`, with name, description and type |
| `dimensions.list` | Required `metrics: [{ name }]`, plus paging/search | `data.dimensionsPaginated`, with name, description and type |
| `savedQueries.list` | Paging and optional search | `data.savedQueriesPaginated`, with name and description |

Paging inputs are `pageNum` (default 1, positive GraphQL integer) and `pageSize`
(default 20, local limit 100). `search` is at most 512 characters. Dimension
reads accept 1–100 metric names, each at most 512 characters. Page results keep
`items`, `pageNum`, `pageSize`, `totalItems` and `totalPages`. The original
GraphQL envelope is returned. Empty lists and nullable descriptions are valid.

Each call makes one request. No automatic paging, polling or retries occur.
The fixed documents keep caller data in variables. Environment and host are
configuration values, never operation overrides. Unknown operations, fields,
malformed pages and partial GraphQL errors fail before data is returned.
HTTP 401 requires reconnection; 403 reports denied permission; 429 reports
rate limiting. GraphQL error text is not used to guess authentication state
or exposed to the caller. Host, environment and token-reference changes require
reverification; updating the existing secret binding supports token rotation.
Disconnect removes local connection state, not the provider token.

## Application and CLI wiring

Compose this provider with the existing connection service, your file-backed
store, Env resolver and authorization callback. Vibe64 writes the same JSON;
it is not needed at runtime. After explicit token verification:

```js
const started = await connections.invoke({
  context, integrationId: "metrics", operation: "queries.create",
  input: {
    metrics: [{ name: "order_total" }],
    groupBy: [{ name: "metric_time", grain: "MONTH" }],
    limit: 100
  }
});
const page = await connections.invoke({
  context, integrationId: "metrics", operation: "queries.get",
  input: { queryId: started.data.createQuery.queryId, pageNum: 1 }
});
// If pending, schedule a bounded later check using the SAME query ID.
// If SUCCESSFUL, render page.data.query.jsonResult.data using its table schema.
```

Other frameworks use their native HTTP client with the same host, exact string
Environment ID and backend Env token. They send the documented GraphQL requests
and implement their own result parsing/access policy. No JSKIT dependency or
Vibe64 service is required for those applications.

## Public, Online and universal URLs

This service-token variant has **no OAuth registration or callback URL**.
There is no universal URL to enter in dbt for it. The customer's VM or custom
domain can invoke the same backend library with the same configuration. Its
identity and authorized environment must remain stable when the address changes.

Each application owner supplies the customer's token and selected environment
through its own configuration and private Env. Its backend enforces access and
usage limits. Separate tokens do not establish independent account or warehouse
capacity; confirm any required provider arrangement. The adapter does not
provision provider accounts or warehouse capacity.

## Automation assessment

| Work | Feasibility |
|---|---|
| Write or edit configuration and wire the runtime | AI can use these exports, schema and ordinary file storage with externally supplied references. |
| Read metadata and query metric values | Implemented API operations; a valid customer token/environment are required. |
| Create two OAuth applications | Not applicable to the captured service-token flow. |
| Provision warehouse identities, dbt credentials and service tokens | Account-admin setup is required. The reviewed setup instructions do not establish a complete provisioning API; do not claim automated creation. An authorized operator can follow the portal steps above. |
| Choose account capacity or grant access | Requires the owner's account and warehouse decisions. No change is made by saving a form. |

## Current limits and evidence

Queries accept 1–100 metrics (`name`, optional `alias`), up to 100 dimensions
(`name`, optional `grain`: DAY/WEEK/MONTH/QUARTER/YEAR), and up to 20 trusted
`where: [{sql}]` filters. For example, group `order_total` by `metric_time` at
MONTH grain and filter with `{{ Dimension('metric_time') }} >= '2026-01-01'`.
The fixed GraphQL document uses variables, but SQL templates remain executable
provider expressions: the backend must construct trusted filters and enforce
customer access. Never interpolate arbitrary app-user text into them.

Submit once using `queries.create`; retain its ID and call `queries.get` at a
bounded interval while pending. SUCCESSFUL returns a decoded pandas TABLE object:
rows are in `jsonResult.data`, column metadata in `jsonResult.schema.fields`.
Request each page explicitly through `totalPages`; the provider normally uses
1024 rows per page. Local JSON pages are bounded to 5 MiB/1024 rows. FAILED raises
a generic error; inspect dbt for details. No retries or background polling are
performed, and a timed-out submission may still execute and consume warehouse
capacity. The app owns submission deduplication, deadlines and authorization.

**LIMITATIONS:** dbt recommends JSON for testing/validation because of its
performance cost. This path supports small metric tables; large production
analytics should use native dbt/Arrow tooling. Arrow decoding, SQL compilation,
saved-query execution, webhooks and app-user login are not supplied. For example,
an app can fetch monthly revenue and render its own chart, but this connector
does not build the chart or a continuous warehouse dashboard. Editor
Codex/OpenCode attachment remains deferred. Personal access
tokens are another documented provider option; the captured service-token setup
is the supported initial onboarding journey.

Controlled HTTP/file tests cover configuration, host restrictions, precise IDs,
metadata, empty pages, ownership, restart, rotation, malformed responses,
permission failures, cancellation and timeout. Live account setup, actual data
access and generated applications are not exercised. Editor form proof is
recorded separately when the installed package has passed browser checks.
