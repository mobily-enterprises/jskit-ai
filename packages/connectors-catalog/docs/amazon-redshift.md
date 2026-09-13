# Amazon Redshift

Import `amazonRedshiftProvider` from
`@jskit-ai/connectors-catalog/server/amazon-redshift`. The runtime uses the official
AWS Redshift Data SDK and explicit AWS credential references. It supports shared
and assistant connections to a serverless workgroup or provisioned cluster.
Per-user Identity Center federation is still unfinished; this shared connection
must not be presented as each application user's independent AWS identity.

## Portable configuration

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "warehouse": {
      "provider": "amazon-redshift",
      "displayName": "Reporting warehouse",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:AWS_SECRET_ACCESS_KEY"
      },
      "settings": {
        "deploymentType": "serverless",
        "region": "us-east-1",
        "accessKeyIdRef": "env:AWS_ACCESS_KEY_ID",
        "workgroup": "analytics",
        "database": "dev"
      }
    }
  }
}
```

For a provisioned cluster, set `deploymentType` to `provisioned`, replace
`workgroup` with `clusterIdentifier`, and optionally add `databaseUser`. For
temporary AWS credentials add `sessionTokenRef`; the host renews the complete
credential set. The default type is `serverless` and default region is
`us-east-1`. Explicitly select the warehouse's real region. The form lists 34
commercial regions; that list does not guarantee that every account/deployment
supports every region. Noncommercial partitions and arbitrary endpoints are not
accepted. This fragment takes a workgroup **name**, not an ARN.

The shared schema selects the correct fields. Serverless requires `workgroup`;
provisioned requires `clusterIdentifier` and accepts optional `databaseUser`.
Both require `database` and AWS key references. CLI mixed-mode fields fail
validation. Switching type in the shared form removes the other type's fields;
it preserves credentials, region, database, other slots and extension data.
Database identifiers retain their exact spelling and whitespace.

## Administrator setup

Use an existing warehouse when one is available. For a new serverless warehouse:

1. In the AWS console, select the intended account and region and open Amazon
   Redshift. Choose **Serverless dashboard > Create workgroup**.
2. Enter the workgroup name and select the IP mode, VPC, subnets and security
   groups for that workload. Choose capacity suitable for the account's budget.
3. Create a namespace or select an existing namespace. For a new namespace,
   supply its database name and configure administrator credentials, encryption
   and logging. A warehouse's associated IAM role for data access is separate
   from the identity that calls this connector.
4. Review the selections and save. Once available, copy the workgroup name and
   database name into the configuration.

These console steps follow [Create a workgroup with a namespace](https://docs.aws.amazon.com/redshift/latest/mgmt/serverless-console-workgroups-create-workgroup-wizard.html).

For a provisioned warehouse:

1. In Amazon Redshift, choose **Clusters** and select the intended cluster.
   To create one, choose **Create cluster** and supply its identifier, node
   configuration and administrator credential method.
2. Review database, VPC/subnet, security group, encryption and maintenance
   settings before creating it. Copy its identifier and database name.
3. Choose whether calls should use an IAM-derived database user or a specific
   existing database user. Only the latter needs `databaseUser` in this file.

See [Create a cluster](https://docs.aws.amazon.com/redshift/latest/mgmt/create-cluster.html).

For either deployment type:

1. Follow [AWS credential setup](aws-credentials.md). Grant the caller only the
   needed `redshift-data` actions: `ListDatabases`, `ListSchemas`, `ListTables`, `DescribeTable`,
   `ExecuteStatement`, `DescribeStatement`, `GetStatementResult` and
   `CancelStatement` for the operations the application exposes.
2. Grant the matching database credential action: serverless needs
   `redshift-serverless:GetCredentials`; provisioned IAM-derived users need
   `redshift:GetClusterCredentialsWithIAM`; provisioned explicit database users
   need `redshift:GetClusterCredentials`. Restrict resource access in IAM.
3. Have the database administrator grant access to the intended schemas/tables
   to the resulting database identity. Use database permissions to enforce
   read-only access where required; accepting SQL does not make it SELECT-only.
4. Store the access key ID, secret key and any session token in the application's
   secret environment. Enter references through Vibe64 or edit the JSON file.
5. Save, then explicitly call `connectApiKey`. It lists one metadata page in the
   configured database. An empty table list can still be a successful connection;
   it does not prove permission to read every table or execute every statement.

The credential combinations are specified by [ExecuteStatement](https://docs.aws.amazon.com/redshift-data/latest/APIReference/API_ExecuteStatement.html).
The adapter does not use a host profile, instance metadata, database passwords
or a Secrets Manager ARN as an implicit fallback.

## Runtime contract

| Operation | Input | Output |
|---|---|---|
| `databases.list` | Optional `maxResults` 1–1000 (default 100), opaque `nextToken` | `Databases` name page and optional `NextToken` |
| `schemas.list` | Optional `schemaPattern`, `maxResults` 1–1000, `nextToken` | `Schemas` name page and optional `NextToken` |
| `tables.list` | Optional `schemaPattern`, `tablePattern`, `maxResults` 1–1000 (default 100), opaque `nextToken` | `Tables` metadata page and optional `NextToken` |
| `table.describe` | `table`; optional `schema`, `maxResults` 1–1000, `nextToken` | `ColumnList`, `TableName` and optional cursor |
| `query.start` | Exact `sql`, required `clientToken` 1–64 characters; optional `parameters: [{name, value}]` | `Id` and submission metadata |
| `query.status` | `statementId` | AWS statement status and execution metadata |
| `query.results` | `statementId`; optional `nextToken` | One JSON result page with typed cells and column metadata |
| `query.cancel` | `statementId` | AWS boolean `Status` acknowledgement |

Database discovery uses the configured database to authenticate and can return
other visible database names. It does not grant access to them or change this
connection's target. Schema and table discovery remain in the configured database;
use another explicitly configured connection to work in another database.
The application authorizes metadata visibility as well as SQL. Names and opaque
cursors remain unchanged; an absent or empty cursor ends pagination.
See [ListDatabases](https://docs.aws.amazon.com/redshift-data/latest/APIReference/API_ListDatabases.html)
and [ListSchemas](https://docs.aws.amazon.com/redshift-data/latest/APIReference/API_ListSchemas.html).
Native framework consumers use those same SDK operations and project credentials.

Table filters retain SQL metadata wildcards `%` and `_`; names and cursors are
passed unchanged. See [ListTables](https://docs.aws.amazon.com/redshift-data/latest/APIReference/API_ListTables.html)
and [DescribeTable](https://docs.aws.amazon.com/redshift-data/latest/APIReference/API_DescribeTable.html).

SQL is preserved and locally capped at 200000 UTF-8 bytes. Parameter names are
unique alphanumeric/underscore strings; values are nonempty strings, including
exact decimal/large-integer text. The fragment permits 1–100 parameters, values
up to 65536 characters. Omit the array for statements without parameters.
These are local bounds; AWS validates SQL and converts parameter values.
Use parameters for values rather than concatenating user input into SQL.
See [SqlParameter](https://docs.aws.amazon.com/redshift-data/latest/APIReference/API_SqlParameter.html).

The host authorizes the exact SQL, target and logical request before starting.
Persist `clientToken` and the returned `Id` with application ownership in
application-owned state; files work. AWS deduplication tokens have a limited
retention window, so an ambiguous submission is not permission to issue a new
token. AWS currently documents an eight-hour token window and 24-hour result
retention in [Data API considerations](https://docs.aws.amazon.com/redshift/latest/mgmt/data-api.html).
The runtime performs no automatic retries, polling, session reuse or batch SQL.

Status/results/cancel first describe the statement and check its ID, database,
workgroup or cluster, and explicit database user when configured. Matching a
warehouse is not application-user ownership. The host must enforce ownership
within a shared warehouse. Status metadata can contain SQL and database errors;
return it only to an authorized caller. See [DescribeStatement](https://docs.aws.amazon.com/redshift-data/latest/APIReference/API_DescribeStatement.html).

Results require `FINISHED` and `HasResultSet`. Preserve AWS column metadata and
typed cells, including null, empty string, boolean, number and binary values.
Binary fields are SDK `Uint8Array` values; encode them explicitly if your own
transport sends JSON. Integers outside JavaScript's safe range are rejected;
cast exact large integers to VARCHAR in SQL when they must be returned as text.
No row-size parameter is invented for this endpoint: request another page only
with AWS's cursor and use an authorized SQL limit when appropriate. See
[GetStatementResult](https://docs.aws.amazon.com/redshift-data/latest/APIReference/API_GetStatementResult.html).

Local abort, timeout or disconnect does not stop a remote query. Explicit
`query.cancel` requests cancellation; inspect status separately if the final
outcome is needed. A boolean acknowledgement is not proof of rollback. See
[CancelStatement](https://docs.aws.amazon.com/redshift-data/latest/APIReference/API_CancelStatement.html).
HTTP failures are redacted; credential renewal, IAM denial, throttling,
configuration errors and missing resources are distinct outcomes.

## Automation and application ownership

An already authorized AI can create/configure resources using AWS APIs. The
Serverless APIs expose `CreateNamespace`, `CreateWorkgroup` and their update/read
operations; see [Workgroups and namespaces](https://docs.aws.amazon.com/redshift/latest/mgmt/serverless-workgroup-namespace.html).
Provisioned creation uses [CreateCluster](https://docs.aws.amazon.com/redshift/latest/APIReference/API_CreateCluster.html).
IAM policies, resource creation, database grants, billing choices and credential
renewal require the corresponding administrator authority. This connector runs
Data API operations; it does not provision accounts or warehouses.

There is **no OAuth callback URL** for the implemented credential mode. Online,
desktop and independent CLI can all use the same JSON and runtime. A customer's
VPS or custom domain does not change the AWS API endpoint or credential binding.
The application owner supplies AWS credentials through private Env or its
credential store. Resource names and editable `env:` references do not grant
AWS permissions. Separate IAM keys alone do not promise isolated service quotas. See [AWS ownership](aws-credentials.md#online-public-editor-and-independent-cli).

## Per-user federation still to deliver

The per-user design requires an organizational identity provider and IAM
Identity Center trusted identity propagation. It is not implemented by this
adapter's API-key mode. AWS describes the database integration and identity-bound
statement access in [Data API trusted identity propagation](https://docs.aws.amazon.com/redshift/latest/mgmt/data-api-trusted-identity-propagation.html).

The remaining configuration must capture the **identity provider issuer URL,
OAuth client ID and secret reference, AWS region, Identity Center application
ARN, bootstrap role ARN, and access role ARN**. The provider registration needs
the application's explicitly configured callback, whether hosted by Vibe64 or
operated independently. Start from the project's actual public address and
register the exact callback implemented by the application. No production
Redshift federation callback implementation is shipped yet.

Remaining runtime work includes OIDC discovery and token verification, the
bootstrap web-identity role exchange, IAM Identity Center token exchange,
identity-enhanced access-role credentials, renewal and individual connection
ownership. Each step must preserve issuer, audience, application and user
boundaries. Detailed federation setup screens and controlled exchange tests
remain planned. Do not substitute the builder's AWS credentials for this mode.

## Focused verification

`test/amazon-redshift.test.js` uses the real AWS SDK against controlled HTTP
responses and protected temporary files. It covers both target types, explicit
DB users, conditional CLI validation, metadata pages, SQL parameters, query
states, results, target isolation, credentials, errors and cancellation.
Shared-form browser checks pass at 390, 820 and 1440 pixels, including CLI
imports, invalid fields, deployment changes and configuration export. Public
editor phone/desktop checks pass for region selection, credential references,
both target types, invalid-save rejection, inactive-field removal and reload.
No live AWS registration, warehouse, SQL, generated app or federation flow has
been exercised.

## Existing-scope closeout — 13 September 2026

Shared project-owned AWS credentials support serverless/provisioned targets, databases/schemas/tables discovery, table description, parameterized SQL submission, status, typed result pages and cancellation.

No per-user Identity Center/OIDC federation or trusted identity propagation; no role-exchange/automatic credential renewal, default host credential chain, database password or Secrets Manager ARN mode, noncommercial partitions, custom endpoints, warehouse/IAM provisioning, batch SQL, automatic polling/retries or application job-ownership registry. SQL is not SELECT-only: database grants and application authorization enforce allowed work. The host stores request/statement ownership, handles uncertain submission and explicitly cancels remote jobs; local timeout/disconnect cannot do that. Unsafe JavaScript integer results are rejected; cast exact values to text. To extend: implement the already documented federation inputs/exchanges and tests, optional authentication modes and desired orchestration separately. No live provider account, provider registration, paid request or generated-application execution was tested. No new editor coding-assistant tool attachment is claimed. Other frameworks use the same project configuration and their own native tools; JSKIT is optional.

16 source and 16 installed-package tests passed on September 13 using the actual AWS SDK with controlled HTTP and private files. September 12 compact/expanded form/lifecycle evidence is retained; no new UI run.
