# BigQuery

Import `bigqueryProvider` from `@jskit-ai/connectors-catalog/server/bigquery`.
**Existing-scope delivery: delegated OAuth only.** Federation is not implemented. Query
submission and results use the configured project. The project-list connection
check does not establish job or dataset permissions.

This fragment lists projects and datasets, reads table metadata, submits GoogleSQL queries and retrieves results
using delegated Google OAuth. The generated application owns these operations.

## Registration and manual setup

1. Follow the numbered [Google OAuth setup](google-oauth.md) to choose/create
   the Cloud project and configure branding, audience and test users.
2. In **APIs & Services → Library**, enable **BigQuery API**
   (`bigquery.googleapis.com`). Create a Web application OAuth client with the
   exact callback URI served by the backend.
3. In **Data Access**, add
   `https://www.googleapis.com/auth/bigquery`. Store client secret and
   callback URL in Env, then save their references and client ID in the shared
   registration. Choose provider `bigquery` and the OAuth registration reference.
4. Enter **Google Cloud project ID**: the project intended to run and pay for
   queries. It may differ from the dataset project. This is saved as
   `settings.projectId`; it is not an OAuth registration or secret.
5. Connect the Google account that should read project metadata. Project IAM
   access is separate from OAuth consent; the list filters to enabled projects
   on which the caller has an applicable project-level role.
   [Project-list requirements](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/projects/list).

## Runtime and AI composition

`projects.list` calls `GET https://bigquery.googleapis.com/bigquery/v2/projects`.
It accepts `maxResults` (1–50, default 50 in this fragment) and optional
`pageToken`. Keep following `nextPageToken` even if a page is shorter than
requested: server filtering can shorten pages. Results retain `totalItems`
and project references; `projects` may be absent when `totalItems` is zero.
[Endpoint](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/projects/list).

The form also exposes broader documented scopes, including Cloud read-only
and full access. Query operations require `bigquery` or `cloud-platform`. Compose
the [connection pattern](../patterns/api-key-connection/PATTERN.md) with the
file store and OAuth `beginAuthorization` / `completeAuthorization`; verification
input is empty. The application owns callback routing and access policy.
Service-account keys, ADC and workload identity are separate authentication
options, not implemented by this delegated-OAuth fragment.
[Authentication options](https://docs.cloud.google.com/bigquery/docs/authentication).

`jobs.query` submits GoogleSQL to `settings.projectId`. Input includes `query`,
optional `location`, `maximumBytesBilled` and `requestId`; `maxResults` defaults
to 100 (maximum 1000), and `timeoutMs` to 1000 (maximum 10000). This operation
can incur charges and perform writes permitted by IAM. The application's
backend must authorize its use and supply trusted SQL; never concatenate user
input into SQL. Pass up to 100 named scalar `parameters`, each with `name`,
`type` and a string `value`. For example, SQL `SELECT @name` takes
`parameters: [{ name: "name", type: "STRING", value: userInput }]`.
Values are sent separately from SQL using Google's named parameter format.
Array, struct and null parameters are not currently supported.
[Parameterized queries](https://docs.cloud.google.com/bigquery/docs/parameterized-queries).

If `jobComplete` is false, call `jobs.getQueryResults` with the returned `jobId`
and location. Pass `pageToken` for subsequent pages. Both operations use the
configured project; callers cannot override it. Results remain provider-shaped,
including warnings/errors for application handling. SQL and query-result page
tokens preserve whitespace. Rows retain native cells, nested records/repeated
values, nulls and decimal/large-integer strings; do not coerce them to JavaScript
numbers. Structural response validation rejects malformed row containers. There is no automatic retry
or polling, dry-run operation, or job ownership registry here.
The application must restrict job access within its own authorization policy.
[Query API](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query),
[result API](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/jobs/getQueryResults).

## Dataset, table and job operations

All operations below use `settings.projectId`; operation inputs cannot override
it. Use another project-owned configuration slot for metadata in another project.
Discovery requires the corresponding dataset/table IAM access independently of
OAuth consent. Neither discovery nor connection verification submits SQL.

| Operation | Inputs | Returned data |
|---|---|---|
| `datasets.list` | Optional `maxResults` 1–1000 (default 100), `pageToken` | Native dataset page |
| `tables.list` | `datasetId`; optional `maxResults`, `pageToken` | Native table page |
| `tables.get` | `datasetId`, `tableId` | Table metadata and schema, not table rows |
| `jobs.get` | `jobId`; optional `location` | Job status, statistics and error details |
| `jobs.cancel` | `jobId`; optional `location` | Cancellation response containing job metadata |

Metadata listing preserves references and opaque pagination tokens. Empty lists
can omit their collection field. Table schemas retain provider field types and
nested structure. Use query results to obtain data; fetching table metadata does
not fetch its rows. Native framework consumers can use the same
[datasets.list](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/datasets/list),
[tables.list](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/tables/list)
and [tables.get](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/tables/get)
methods with their own Google libraries.

The application must authorize each job ID before inspection or cancellation.
Retain its region and use it when calling these operations. `jobs.get` preserves
PENDING, RUNNING and DONE, including `status.errorResult`: DONE does not mean
success. Job metadata can contain SQL and errors, so do not expose it to other
users. See [jobs.get](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/jobs/get).

`jobs.cancel` requests cancellation; it does not prove the job stopped or that
charges were avoided. Inspect status afterwards. A local abort/disconnect does
not cancel the remote job. The cancellation request is not automatically retried.
See [jobs.cancel](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/jobs/cancel).

## Federation ownership — not implemented yet

Federation needs a trusted external identity as well as a workload identity
provider audience and a service-account email. Those two settings alone cannot
produce credentials. The generated application's deployment must supply the
identity; an editor login, project URL or OAuth client ID is not that identity.

For a deployment with an OIDC issuer, its operator configures a Google workload
identity pool/provider, grants that identity permission to impersonate the
service account, and generates Google's external-account credential
configuration. The Node application can use Google's authentication library;
other frameworks use their supported Google authentication tools. File-sourced
OIDC tokens require the deployment to update the token file before expiration.
[Google authentication library federation setup](https://github.com/googleapis/google-auth-library-nodejs#workload-identity-federation).

Vibe64 should edit the application configuration and Env references. It must
not issue deployment identities or require an exported application to call a
Vibe64 token gateway. The runtime implementation still needs to define and
validate its credential-source input and prove exchange and renewal before this
mode can be offered as working.

## Automation and application ownership

An authorized AI can prepare configuration, enable the API and assist with IAM
using existing Google administration APIs or gcloud. Web-client registration,
branding/review and account consent follow the common console guide.
The application owner supplies its OAuth registration and data-project access.
Separate OAuth projects do not automatically separate compute billing or resource
limits. Query submission uses the configured billing/execution project.

Automated tests cover consent, scopes, replay, private-file restart, isolation,
pagination, empty pages and provider failures without live queries or projects.

## Existing-scope closeout — 13 September 2026

Project-owned delegated Google OAuth supports project/dataset/table discovery, table metadata, named scalar GoogleSQL parameters, query submission, job status, result pagination and cancellation in the configured execution project.

No service-account key, ADC, workload-identity federation or deployment identity issuance. No array/struct/null parameters, automatic retry/polling/pagination, dry-run operation, load/extract/copy/streaming jobs, dedicated dataset/table administration or cross-project input override. SQL may incur charges and perform IAM-permitted writes; maximumBytesBilled is optional, not an account budget. Connection checking lists projects and does not prove query/dataset permissions. The app owns SQL authorization, per-user job ownership, result rendering, billing choices and cancellation follow-up; DONE or a cancellation acknowledgement does not prove successful execution/stopping. To extend: implement deployment-owned federation and its renewal/tests, then only required job/parameter modes. No Vibe64 identity gateway. No live provider account, provider registration, paid request or generated-application execution was tested. No new editor coding-assistant tool attachment is claimed. Other frameworks use the same project configuration and their own native tools; JSKIT is optional.

9 source and 9 installed-package BigQuery checks passed on September 13. September 12 compact/expanded configuration, IAM guidance and lifecycle browser evidence is retained; no new UI run.
