# AWS Athena

Import `awsAthenaProvider` from
`@jskit-ai/connectors-catalog/server/aws-athena`. Use the same connection service,
Feature, file storage and shared configuration form as other API-key providers.
The fragment executes Athena SQL operations through the official AWS SDK.

## Portable configuration

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "queries": {
      "provider": "aws-athena",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:AWS_SECRET_ACCESS_KEY"
      },
      "settings": {
        "region": "ap-southeast-2",
        "accessKeyIdRef": "env:AWS_ACCESS_KEY_ID",
        "workgroup": "reports",
        "resultLocation": "s3://query-results/reports/"
      }
    }
  }
}
```

`workgroup` defaults to `primary`. Omit `resultLocation` when the workgroup
supplies result storage. Enforced workgroup configuration takes precedence over
client result settings, as documented in
[Override client-side settings](https://docs.aws.amazon.com/athena/latest/ug/workgroups-settings-override.html).
Temporary credentials also need `settings.sessionTokenRef`. `assistant`
ownership is supported; application users still share the configured AWS identity.

## Administrator setup

1. In the Athena console, select the intended AWS account and region.
2. Open **Workgroups** in the navigation pane. Select an existing SQL workgroup or
   choose **Create workgroup**, enter its name, and select the Athena SQL engine and **AWS Identity and Access Management (IAM)** authentication.
3. Configure result storage for that workgroup. For S3-backed results, select a
   bucket/prefix with the intended encryption and ownership. Set a per-query
   data scan limit; choose **Override client-side settings** if the workgroup
   must enforce those settings. Choose **Create workgroup** or save your edits.
4. Give the backend identity `athena:GetWorkGroup`, `StartQueryExecution`,
   `GetQueryExecution`, `GetQueryResults` and `StopQueryExecution` on the intended
   workgroup. Grant only the required source data, catalog, result storage and
   encryption access. Permissions depend on the actual query's data sources.
5. Follow [AWS credential setup](aws-credentials.md), enter the references,
   region and workgroup in Vibe64 or the JSON file, and save.
6. In the editor, use **Set credential in Env** for each saved reference and enter
   its value, then return and choose **Connect account**. CLI callers resolve the
   same references from their private environment and call `connectApiKey`.
   Temporary credentials require all three values to be renewed together.
   The connection check reads workgroup metadata; it does
   not run a query, verify table access or prove result-bucket permissions.

Console configuration follows [Create a workgroup](https://docs.aws.amazon.com/athena/latest/ug/creating-workgroups.html).
An authorized AI can automate workgroup creation with
[CreateWorkGroup](https://docs.aws.amazon.com/athena/latest/APIReference/API_CreateWorkGroup.html)
and separately configure IAM, Glue/S3 resources and encryption. It cannot grant
itself account access. Neither provisioning nor credential renewal is part of
this fragment.

For Online and public operation there is **no OAuth callback URL** in this
mode. See [AWS ownership and quota isolation](aws-credentials.md#online-public-editor-and-independent-cli).
Separate workgroups do not isolate account service quotas. The application
operator supplies AWS credentials, chooses resources and controls their budget.
The same application-owned setup works from CLI or editor without a Vibe64
managed service.

## Runtime contract

| Operation | Inputs | Result |
|---|---|---|
| `workgroup.get` | None | Configured workgroup metadata, including enabled/disabled state |
| `catalogs.list` | Optional `maxResults` 2–50 (default 50), opaque `nextToken` | Catalog summaries |
| `databases.list` | `catalog`; optional `maxResults` 1–50, `nextToken` | Database names and metadata |
| `tables.list` | `catalog`, `database`; optional `maxResults` 1–50, `nextToken` | Table metadata, columns and partition-key types |
| `query.start` | `sql`, `clientRequestToken` (32–128 chars); optional `database`, `catalog` | `QueryExecutionId` |
| `query.status` | `queryId` | Query execution, status, statistics and result configuration |
| `query.results` | `queryId`; optional `maxResults` 1–1000 (default 100), opaque `nextToken` | One DATA_ROWS result page |
| `query.cancel` | `queryId` | Empty success receipt after StopQueryExecution |

Query statements are not restricted to SELECT. The host's authorization policy
must approve the exact SQL and bound data access before invocation. SQL is
preserved, limited to 262144 UTF-8 bytes and never submitted during connection.
A client request token must identify one application-authorized logical query;
reuse the same token and input when resolving an uncertain submission. The SDK
is configured for one attempt; there is no automatic query replay. AWS describes
token reuse in [StartQueryExecution](https://docs.aws.amazon.com/athena/latest/APIReference/API_StartQueryExecution.html).

Status, results and cancellation first fetch the execution and reject a query
outside the configured workgroup. This does not isolate users within a shared
workgroup. The host must maintain query ownership and authorize each `queryId`.
The fragment returns queued, running, succeeded, failed and cancelled states;
it does not poll, schedule or invent completion. See
[GetQueryExecution](https://docs.aws.amazon.com/athena/latest/APIReference/API_GetQueryExecution.html).

Results preserve column metadata, header rows, empty cells and string values.
Do not coerce large numbers or silently drop the first row. Follow `NextToken`
explicitly; one page is not the full result. S3-backed results require S3 access
as well as Athena permissions. See
[GetQueryResults](https://docs.aws.amazon.com/athena/latest/APIReference/API_GetQueryResults.html).

Cancelling the local HTTP call or disconnecting does not stop an AWS query.
`query.cancel` explicitly requests
[StopQueryExecution](https://docs.aws.amazon.com/athena/latest/APIReference/API_StopQueryExecution.html);
read status afterwards if final cancellation must be confirmed. Catalog
provisioning, prepared statements, execution parameters, Spark, identity-center
federation and result manifest operations are outside this fragment.

Local tests exercise real SDK serialization/signing against controlled HTTP,
file restart, permission boundaries, job states and cancellation. No live SQL,
AWS account provisioning or generated application is used.


## Catalog browsing

Use `catalogs.list`, then `databases.list` for the selected catalog and
`tables.list` for its selected database. Each operation returns one native AWS
page; pass `NextToken` unchanged to continue. Column types remain provider
strings, including decimal precision and nested types. These calls do not run SQL.

The configured workgroup is sent on each request, but does not restrict which
catalogs are visible to that IAM identity. Authorize the exact catalog/database
and returned metadata in the application, separately from query ownership.
Grant `athena:ListDataCatalogs`, `athena:ListDatabases` and
`athena:ListTableMetadata` as needed. Glue-backed catalogs also require the
appropriate `glue:GetDatabase`, `glue:GetDatabases`, `glue:GetTable` and
`glue:GetTables` resource grants. Do not broaden them automatically after denial.

```js
const databases = await service.invoke({ context, integrationId: "queries",
  operation: "databases.list", input: { catalog: authorizedCatalog } });
const tables = await service.invoke({ context, integrationId: "queries",
  operation: "tables.list",
  input: { catalog: authorizedCatalog, database: authorizedDatabase } });
```

Native implementations in other frameworks use AWS
[ListDataCatalogs](https://docs.aws.amazon.com/athena/latest/APIReference/API_ListDataCatalogs.html),
[ListDatabases](https://docs.aws.amazon.com/athena/latest/APIReference/API_ListDatabases.html)
and [ListTableMetadata](https://docs.aws.amazon.com/athena/latest/APIReference/API_ListTableMetadata.html)
with the same project credential bindings and application authorization.
