# Semrush

Import `semrushProvider` from `@jskit-ai/connectors-catalog/server/semrush`.
This adapter manages Projects API V4 records and reads keyword/backlink reports using an application-owned V4 API key.
It works with the shared CLI/server connection service and encrypted file store;
Vibe64 edits the same portable configuration. Saving fields does not verify a key.

## Create and configure a key

1. Sign into the Semrush account that will own the usage. Projects API access
   requires SEO Business and available API units. Check that account's entitlement
   before provisioning; a key alone does not supply API access.
2. Open the top-right profile icon. In **My profile**, choose **API Keys**.
3. Choose **+ Create API key** and create a **V4** key. Give it an application
   name, select **Read-only** for reads or **Read and write** for creating or
   renaming or deleting projects, and choose an expiry appropriate for the host.
4. Copy the value when shown. Store it in the runtime's environment or secret
   store; configure only its reference below. The full value is shown once.
5. Save the JSON through the CLI or Vibe64. Explicitly call `connectApiKey` to
   verify accessible projects. Empty project lists are valid.
6. For rotation, create a replacement V4 key, update the same binding, verify
   access, then revoke the old key in the provider portal. Changing just the
   environment value does not require rewriting source configuration.

Sources: [key creation](https://developer.semrush.com/api/v4/get-started/quick-start/),
[permissions and expiry](https://developer.semrush.com/api/v4/get-started/authorization/),
[Projects prerequisites](https://developer.semrush.com/api/v4/projects/overview/).

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "seo": {
      "provider": "semrush",
      "displayName": "Marketing projects",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:SEMRUSH_V4_KEY"
      }
    }
  }
}
```

`assistant` is also supported when the host authorizes that assistant. Neither
mode creates individual provider accounts for app users. The current form has
no client registration, callback or scope checkboxes. API-key permissions are
chosen in Semrush. V3 keys cannot be substituted for V4 keys; OAuth access tokens
are another credential type. [API versions](https://developer.semrush.com/api/v4/introduction/api-versions/)

## Runtime operations

| Operation | Input | Result |
|---|---|---|
| `projects.list` (verification) | Optional `scope`: `OWN` (default), `ALL`, `SHARED`, `CORPORATE`; `limit`: 1–1000 (default 100); `offset`: nonnegative safe integer (default 0) | Original `meta` and `data` envelope, including total count and project permissions |
| `projects.get` | Required positive safe-integer `projectId` | Project envelope; returned ID must match the request |
| `projects.create` | `domain` without a protocol/path and `project_name` | Created project envelope with assigned ID; the name/domain must match the request |
| `projects.update` | `projectId` and nonempty `project_name` | Renamed project envelope; changing the domain is not supported |

The adapter uses `https://api.semrush.com/apis/v4/projects/v1/projects` and the
documented `Apikey` header. It makes one explicit request per operation, does
not follow redirects or fetch later pages, and rejects malformed responses,
unsafe numeric IDs and mismatched pagination. Project results include provider
ownership and permission metadata; the host must still authorize the caller
and the particular project. List scope is an operation filter, not an OAuth scope.
[Projects API](https://developer.semrush.com/api/v4/projects/projects/)

Creation uses POST; rename uses PATCH. These operations require a provider key
with Read and write access plus application authorization before key resolution.
They are never automatic connection checks. Save the returned provider project ID
in application-owned data. If a request fails after submission, inspect the
project list/current name before deciding whether to repeat it; a failed response
is not proof that Semrush made no change. No automatic retry or idempotency
guarantee is supplied.

`projects.delete({ projectId })` permanently removes the provider project, including
its tools, settings and history. The application must authorize deletion and obtain
user confirmation before invoking it. A successful response contains the matching
project ID. This is separate from disconnecting a local connection. An uncertain
response is never retried automatically; inspect the provider before proceeding.
Reports are implemented as described below. OAuth and individual app-user login are not supported; project-owned API keys are the accepted authentication scope.

HTTP-200 error envelopes are failures. Bad-key codes require reconnection;
disabled access becomes a permission error; exhausted capacity becomes
`connector_quota_limited`; missing projects become `connector_resource_not_found`.
Provider error messages are not exposed. HTTP transport failures use the common
connector errors. An aborted read is not replayed. Local disconnect removes
connection state; it does not revoke the provider key.
[Error codes](https://developer.semrush.com/api/v4/projects/overview/)

## Application and callback ownership

The application owner supplies the Semrush account and key. CLI, installed
editor and hosted editor use the same configuration file and private Env
reference. The editor does not provide a provider account, retain the key in a
central connector service or assign capacity based on the editor subscription.

For this V4 key flow, a universal OAuth callback is **not applicable**. VPS
addresses and custom domains do not change provider key authentication. The
application owner supplies its authorized key through private Env and retains
that ownership when moving hosts.

Separate keys on one account share its capacity. The documented general limits
are per account, including 10 requests per second and 10 simultaneous requests;
API-unit and subscription limits also apply. Independent capacity needs an
approved account/subscription arrangement, not just two named keys. The guide
does not establish permission to redistribute provider data through arbitrary
customer apps. [Usage restrictions](https://developer.semrush.com/api/v4/introduction/api-usage-restrictions/)

## Captured OAuth variant and automation

The reference UI offered `user.id`, `user.limits`, `url.info`, `domains.info`,
`backlinks.info`, `subfolders.info`, `projects.info`, and `positiontracking.info`.
That journey is an explicit accepted limitation of this connector. Semrush now deprecates the previous
OAuth Projects endpoints and recommends the current V4 API for new integrations.
Its documented OAuth client credentials require contacting support; device
authorization is a different flow. Do not invent a universal redirect approval
or claim that these eight permissions are implemented by the V4 key adapter.
[OAuth guidance](https://developer.semrush.com/api/v4/get-started/authorization/)

| Task | Automation assessment |
|---|---|
| Create or rotate application keys | No general key-provisioning API was found in the reviewed public setup documentation. An authorized browser operator can assist with the portal steps; account access remains required. |
| Create an application-owned OAuth registration | Provider support is the documented prerequisite. Scope/callback approval and the runtime journey remain unfinished. |
| Configure a CLI or application | AI can write the JSON, compose the library and wire host authorization using externally supplied references. No generated template is required. |
| Read provider projects | Implemented through the documented API with controlled local tests. No actual provider account was used. |

## Verification

Fifteen focused runtime tests cover file persistence/restart, ownership, rotation,
input and response validation, pagination, error codes, transport errors and
interruption, project creation/rename/deletion, write authorization and no replay after
uncertain results. All fifteen also pass in an isolated consumer installed from
the packed catalogue, importing only public package exports. Current phone and
desktop editor checks cover V4 and optional V3 references, raw-secret rejection,
ownership, exact file content, setup instructions and reload persistence. The
phone flow explicitly dismisses the saved notification before its next edit.
Live registrations, provider data, generated applications and managed onboarding
have not been tested.


## Keyword metrics

Invoke `keywords.metrics` with `keyword` (1–255 characters), uppercase two-letter
`country` and optional `month` (`YYYY-MM`, 2012-01 through the current month).
Semrush determines available countries; its documented United Kingdom code is
`UK`. Omit month for the provider's current snapshot. The adapter requests JSON
and returns the report envelope, preserving numeric strings such as search volume
and result counts without precision loss. Framework code owns presentation and
any caching; the connector does not fetch reports during connection checks.
V4 keyword reporting is Early Access and consumes account API units. Provider
entitlement and country availability are checked by Semrush. See the
[current report contract](https://developer.semrush.com/api/v4/seo/keyword-reports/).
Domain and position-tracking operations are described below. Captured OAuth and final provider acceptance remain open.


## Backlink reports

| Operation | Result |
|---|---|
| `backlinks.overview` | Aggregate backlink, referring-domain/page counts and authority score. |
| `backlinks.list` | Individual backlinks, anchors, source and target URLs and link attributes. |
| `backlinks.referringDomains` | Referring domains, backlink counts and domain scores. |
| `backlinks.anchors` | Anchor text, backlink counts and referring-domain counts. |

Supply `url` (domain or URL, at most 2000 characters) and `scope` (`ROOT_DOMAIN`,
`SUBDOMAIN`, `SUBFOLDER`, `PAGE`). The target is a Semrush query parameter, never
a destination fetched by this connector. Reports always return JSON and retain
provider fields. Page operations accept `limit` (default 100, local maximum 1000),
`offset` (default 0), optional `order_by`, `direction` (`ASC`/`DESC`, default DESC),
and optional provider `filter` expression (local maximum 4000 characters).
Semrush validates sort fields and filter syntax. No local filter parser is added.
All provider fields are requested; selecting columns is left to application code.

A page request makes one API call. The caller owns pagination, cost limits and
stopping when no further rows are available. Metadata differs between reports;
anchors may omit totals and page context. The adapter preserves metadata and
validates supplied pagination values. Empty arrays are valid. Report URLs and
anchor text are provider data: use the framework's normal escaping when rendering
and do not interpret them as executable HTML or automatic network destinations.

The V4 reports are Early Access and consume account units. They do not run during
connection checks. A project-access check does not prove entitlement to every
report. See [Semrush's current backlink API](https://developer.semrush.com/api/v4/seo/backlinks/).


## Domain overview and the separate V3 key

`domains.overview({ domain: "example.com", database: "us" })` retrieves one
regional domain overview: rank, organic keywords/traffic/cost and paid
keywords/traffic/cost. It returns `{ columns, rows }`, retaining provider strings
and decimal precision. No data is `{ columns, rows: [] }`. Quoted CSV is decoded;
unexpected columns, malformed rows and decoded reports over 2 MB are rejected.

In **My profile > API Keys**, locate the autogenerated **Version 3** key and put
it in the project's private Env as `SEMRUSH_V3_KEY`. Add
`settings: { "v3ApiKeyRef": "env:SEMRUSH_V3_KEY" }` to the integration JSON or
fill **V3 API key reference (optional)** in Vibe64 and use **Set credential in Env**.
The normal authentication reference still points to the separate V4 key.
Leave the V3 field empty when using only V4 reports and projects.

This extra key is resolved only for V3 reports after application authorization.
It travels in the provider-required `key` query parameter over HTTPS; custom
transport instrumentation must redact query credentials. It is never sent as
V4 authorization. Connecting still verifies V4 projects; the V3 report itself
checks its own entitlement and consumes the account's API units. V3 key errors
do not invalidate a working V4 connection. The editor supplies neither account.
Other frameworks use the same Env reference and Semrush's native HTTP/CSV contract.

Sources: [V3 key setup](https://developer.semrush.com/api/v3/get-started/quick-start/),
[V3 authentication](https://developer.semrush.com/api/v3/get-started/authorization/),
[domain overview](https://developer.semrush.com/api/v3/seo/overview-reports/),
[report errors](https://developer.semrush.com/api/v3/seo/overview/).
Position tracking is described below; captured OAuth is outside the accepted API-key scope.


## Organic and paid keyword detail

The same optional V3 key powers these explicit report operations:

| Operation pair | Required target |
|---|---|
| `domains.organicKeywords`, `domains.paidKeywords` | `domain` |
| `urls.organicKeywords`, `urls.paidKeywords` | `url` |
| `subfolders.organicKeywords`, `subfolders.paidKeywords` | `subfolder` |

All require a lowercase regional `database` such as `us`. Use `limit` (1–1000,
default 100) and `offset` (default 0). The adapter translates them to Semrush's
`display_limit = offset + limit` contract, bounded by the provider's 4,000,000
result window. It does not automatically fetch the next page. Optional
`display_sort` supports position, traffic or volume ascending/descending;
`display_filter` accepts the provider's expression syntax (up to 4000 characters).
Optional `display_date` uses `YYYYMM15`; database-specific history and entitlement
are provider decisions. Historical queries can cost more units than current ones.

Results use `{ columns, rows }` with Keyword, Position, Search Volume, CPC,
Competition, Traffic (%) and Number of Results. Values remain strings, including
large counts, decimals and escaped keyword text. No-data responses return an
empty row list. The application owns cost approval, pagination, presentation and
additional storage. Vibe64 does not execute keyword reports during connection.
Other provider columns are not currently exposed by these focused operations.

Sources: [domain keyword reports](https://developer.semrush.com/api/v3/seo/domain-reports/),
[URL keyword reports](https://developer.semrush.com/api/v3/seo/url-reports/),
[subfolder keyword reports](https://developer.semrush.com/api/v3/seo/subfolder-reports/).


## Position tracking

The optional V3 key also supports `tracking.campaigns({ projectId })`,
`tracking.dates({ campaignId })`, `tracking.organicPositions` and
`tracking.paidPositions`. Start with the application-authorized project ID from
project discovery. Campaign discovery returns campaign IDs, devices, tracked URLs
and harvesting state. Use that returned campaign ID (for example `123_45`),
not the project ID, in dates and position reports. Existing configured campaigns
and harvested data are prerequisites; these operations do not create campaigns.

Position reports accept `campaignId`, optional provider-masked `url` (for example
`*.example.com/*`), `date_begin`/`date_end` as `YYYYMMDD`, optional provider
`display_filter`, and `display_limit` (1–1000, default 10)/`display_offset`
(default 0). These tracking pagination fields are sent directly, unlike SEO CSV
keyword report pagination. Use `tracking.dates` to discover available snapshots.
The provider determines availability for a campaign's engine and device.

The JSON response preserves keyword IDs, date-keyed rankings, visibility and
other provider fields. `data` may be an indexed object rather than a JS array;
use the framework's object-value iteration when rendering rows. The application
must authorize project/campaign access, review unit usage and decide whether to
request another page. Neither Vibe64 nor this adapter automatically polls campaigns.
Connecting only checks V4 project access. Errors from tracking do not invalidate
that separate V4 connection. No live campaigns were queried during verification.

[Position-tracking contract](https://developer.semrush.com/api/v3/projects/position-tracking/)
