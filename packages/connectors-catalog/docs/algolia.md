# Algolia

Import `algoliaProvider` from `@jskit-ai/connectors-catalog/server/algolia`.
This adapter verifies a backend key, searches indices, maintains records and checks indexing tasks.
The portable configuration also carries the optional frontend key reference;
the backend runtime neither resolves nor publishes that optional key.

## Create the application and keys

1. Sign into the Algolia dashboard. Open **Settings → Applications → Create
   Application**. Choose the application name, plan and cluster region; supply
   billing details when the selected plan requires them. Select the new
   application before creating its keys.
   [Application creation](https://support.algolia.com/hc/en-us/articles/4406975239441-How-do-I-create-an-application).
2. Open **API Keys** and copy the **Application ID**. Under **All API Keys**,
   choose **New API Key**. Name it for this application's backend, enable
   `listIndexes` and `search`. Add `addObject` for indexing and task status,
   and `deleteObject` for deletion when needed. Restrict it to the intended indices. Create
   the key and store it in the backend environment as `ALGOLIA_API_KEY`.
   The runtime does not require the Admin key.
   [Key creation](https://support.algolia.com/hc/en-us/articles/9438531643665-How-do-I-generate-keys).
3. If the frontend will query Algolia directly, create a separate key with only
   `search`, restricted to indices containing data that those clients may read.
   Store that value as `ALGOLIA_SEARCH_KEY`. The predefined Search-only key can
   search all application indices, so do not assume it isolates private data.
   [Key types](https://www.algolia.com/doc/guides/security/api-keys).
4. Set appropriate validity, index and request restrictions when creating keys.
   Referrer restrictions alone are not authorization. Replace or delete keys in
   **API Keys → All API Keys** when access should end at Algolia. Local connector
   disconnect only removes the local connection.
   [Key restrictions](https://www.algolia.com/doc/guides/security/api-keys/in-depth/api-key-restrictions).

## File and field ownership

The editor and a manually composed CLI edit the same `integrations.json`:

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "search": {
      "provider": "algolia",
      "displayName": "Product search",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:ALGOLIA_API_KEY"
      },
      "settings": {
        "applicationId": "YOURAPPLICATIONID",
        "publicApiKeyRef": "env:ALGOLIA_SEARCH_KEY"
      }
    }
  }
}
```

The application ID is public configuration. The two key values stay outside
source. Omit `publicApiKeyRef` when all searches go through the backend. The
reference validator accepts the same `env:NAME` format as other connectors.
The shared UI provides an Application ID text field, optional public-key
reference and the primary API-key reference. Vibe64 provides a separate Env
shortcut for each configured key, including a notice that the frontend key may
be published. Clearing its reference removes the shortcut, not the Env value.
Sharing grants remain a separate host responsibility.

The app ID must be 1–63 alphanumeric characters in this fragment so it forms
one DNS label. This is a runtime validation boundary, not a claim that Algolia
issues IDs of every such length. Settings changes require verification again.
The destination is fixed to `https://<application-id>.algolia.net`; arbitrary
hosts and another application's host cannot receive this connection's key.

## Runtime and AI composition

Use the [API-key source pattern](../patterns/api-key-connection/PATTERN.md) with
`providers: [algoliaProvider]`, the file connection store, the application's
reference resolver and its authorization policy. Both configuration and runtime
state are text files. No database, editor process or managed service is required.

```js
await connections.connectApiKey({ context, integrationId: "search" });
const indices = await connections.invoke({
  context, integrationId: "search", operation: "indices.list",
  input: { page: 0, hitsPerPage: 100 }
});
const results = await connections.invoke({
  context, integrationId: "search", operation: "index.search",
  input: { indexName: "products", query: "phone", page: 0, hitsPerPage: 20 }
});
```

`indices.list` performs `GET /1/indexes`; verification invokes its default page
zero, with 100 entries requested. `listIndexes` permission is required, and the
response's `items` and optional `nbPages` remain intact. Empty indices still
allow verification. This does not prove that `search` is granted on a particular
index. [List indices](https://www.algolia.com/doc/rest-api/search/list-indices).

`index.search` performs `POST /1/indexes/{indexName}/query`, with JSON query,
page and page-size values. It requires `search`, preserves hits and pagination,
and defaults to an empty query, page zero and 20 hits. Index names are encoded
as one path component, limited to 255 characters and cannot be `.` or `..`.
Both operations accept pages from zero to 2147483647 and page sizes 1–1000 as
local fragment bounds; provider index/key limits may be tighter. Search does not
bypass Algolia's retrieval limits or automatically browse the full dataset.
[Single-index search](https://www.algolia.com/doc/rest-api/search/search-single-index).
Queries must fit 512 UTF-8 bytes; the validator checks bytes as well as string
length. [Query limits](https://www.algolia.com/doc/api-reference/api-parameters/query).

For direct frontend search, the application may deliberately resolve and expose
only `publicApiKeyRef` plus `applicationId` after configuring a suitable
search-only key. Never serialize `authentication.secretRef`'s resolved value to
the browser. This runtime does not inspect the frontend key's ACL or install a
search widget. Index settings, secured-key generation,
recommendations and host failover are outside the fragment.

## Automation and application ownership

AI-assisted provisioning can use Algolia's CLI after a human completes
`algolia auth login`; that creates a dashboard OAuth session. This is a separate
operator bootstrap, not the API-key connection above.
[CLI authentication](https://www.algolia.com/doc/tools/cli/authentication).
Current CLI documentation exposes `algolia application create`, with name,
region, plan and dry-run options. For example, review each request first:

```sh
algolia application create --name dogandgroom-search --region EU --plan free --dry-run
```

Actual creation requires the chosen plan's terms and, for paid plans, a payment
method. An AI can prepare the requests; the operator owns those choices.
[Create command](https://www.algolia.com/doc/tools/cli/commands/application/create).
The older application-management guide says no programmatic management API
exists; the July 2026 CLI documentation explicitly supports creation through the
Dashboard API. Use the supported CLI rather than guessing private endpoints.

With an explicitly supplied Admin key, the Search API can create restricted
keys through `POST /1/keys`, including `acl`, `indexes`, description, validity
and rate limits. Keep that bootstrap key out of the running connector and issue
a lesser backend key for its required operations.
[Key provisioning](https://www.algolia.com/doc/rest-api/search/add-api-key).

The application owner creates its Algolia application and supplies a scoped key
through private Env. Two keys in one Algolia application do not establish
independent application capacity. Separate applications have their own plans;
dedicated server isolation is a separate provider offering.
[Application isolation](https://www.algolia.com/doc/guides/sending-and-managing-data/manage-indices-and-apps/manage-your-apps).
This flow needs no OAuth callback, so editor VM and custom application domains
do not add provider redirect registrations. This is search access, not user login.

## Proof

Focused tests use simulated provider responses and real temporary encrypted JSON
state. They cover endpoint/header binding, public-key separation, rotation,
restart, ownership, configuration changes, encoded index paths, UTF-8 query
limits, paging, malformed responses and failures. Browser tests cover validated
text inputs, optional-reference clearing, CLI import and save/reload. Live
provider use, real account creation and generated sample apps are untested.

## Maintain the search index

Use `records.replace` with `{ indexName, objectID, attributes }` to create or
fully replace a record. Pick a stable ID from the application's source record;
omitted attributes are removed on replacement. Use `records.update` with the
same inputs to update only specified attributes; this explicitly sets
`createIfNotExists=false`. Both require `addObject`. Supply a nonempty attributes
object and keep the record ID in `objectID`, not inside attributes.
[Replace a record](https://www.algolia.com/doc/rest-api/search/add-or-update-object),
[partial update](https://www.algolia.com/doc/rest-api/search/partial-update-object).

`records.delete` takes `{ indexName, objectID }` and requires `deleteObject`.
Each mutation returns a task ID, not evidence that search results already reflect
the change. Call `tasks.get` with `{ indexName, taskID }`; keep the application
work item pending for `notPublished` and complete it only for `published`.
Task checks require `addObject`. Use a bounded application-owned polling schedule
and retain task IDs for later recovery rather than blocking requests indefinitely.
[Delete a record](https://www.algolia.com/doc/rest-api/search/delete-object),
[task status](https://www.algolia.com/doc/rest-api/search/get-task).

Keep ingestion behind application authorization. Publish only deliberately
searchable data to frontend-accessible indices, and never publish the backend
write key. Do not grant write ACLs to the public search key. A timeout does not
prove a write failed; reconcile the known record/task before retrying, especially
for partial update operators such as increments. No automatic retries are added.

`test/algolia.test.js` now includes replacement, partial update, deletion and
pending/published task progression through the real connection service. It
retains existing search, key-separation, restart and failure tests. Six tests
passed with controlled HTTP, without live indexing or account credentials.
