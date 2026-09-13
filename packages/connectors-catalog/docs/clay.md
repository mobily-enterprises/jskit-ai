# Clay Public API

Reviewed against Clay's API documentation on 12 September 2026. Import
`clayProvider` from `@jskit-ai/connectors-catalog/server/clay`. This adapter verifies user/workspace identity, searches people and companies,
runs enrichment routines, reads results and queries Enterprise tables. It uses a Public API key, not a legacy workspace key.

## Manual setup

1. Sign into the Clay account with access to the intended workspace. Open
   **Settings → Account → API keys (beta)**, or follow the official guide's
   [direct API-key settings link](https://app.clay.com/workspaces/~/settings/account?accountTab=api-keys-beta).
2. Create a Public API key. Copy the newly issued value
   into the backend environment as `CLAY_PUBLIC_API_KEY`.
3. In Vibe64, open **Integrations → Add Clay**. Enter a display name and
   `env:CLAY_PUBLIC_API_KEY` in **Public API key reference**. Choose shared
   application access or assistant access for the intended owner, then save.
4. The host explicitly calls `connectApiKey`. Its `GET /public/v0/me` check
   verifies both user and workspace identity without starting a search.
5. For rotation, create a replacement key, update the existing Env binding and
   verify it before retiring the old key in Clay. Disconnecting the application
   removes local connection state; it does not revoke the provider key.

The provider documents the account navigation and `clay-api-key` header in its
[authentication guide](https://developers.clay.com/public-api/authentication).
The [identity endpoint](https://developers.clay.com/api-reference/me/get-the-authenticated-user)
returns the account and workspace associated with that key. Their names may be
null; a successful check does not prove search capacity or access to every table.
These console instructions are documented, not verified through a live account.
The official guide establishes the destination and key type. Dialog labels may
change; use the Public API key creation action on that page, not the legacy
workspace-key flow. If this page is unavailable to your account, resolve Public
API access with Clay before configuring this connector.

## Portable source and CLI

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "prospects": {
      "provider": "clay",
      "displayName": "Clay prospect search",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:CLAY_PUBLIC_API_KEY"
      }
    }
  }
}
```

Compose this file with `providers: [clayProvider]`, an authorization policy and
the encrypted file connection store as in the
[API-key pattern](../patterns/api-key-connection/PATTERN.md). A CLI uses these
same library methods. Vibe64 writes the same source file and supplies no separate
database requirement.

```js
await connections.connectApiKey({ context, integrationId: "prospects" });
const search = await connections.invoke({
  context, integrationId: "prospects", operation: "searches.create",
  input: { query: approvedQuery }, signal
});
// Bind this returned ID to the authenticated connection in application state.
const page = await connections.invoke({
  context, integrationId: "prospects", operation: "searches.next",
  input: { searchId: search.search_id, limit: 20 }, signal
});
```

`approvedQuery` must follow Clay's current grammar and the application's policy.
Clay publishes that grammar through authenticated
`GET https://api.clay.com/public/v0/search/query-mode/reference`; retrieve it
with the same private header before authoring queries. Use `searches.reference` to retrieve the current grammar. The query endpoint supports people
and companies, excluding count queries and jobs.
[Query guidance](https://developers.clay.com/searches/advanced),
[search creation](https://developers.clay.com/api-reference/search/create-a-search-from-a-clay-search-query).

`searches.next` calls `POST /public/v0/search/query-mode/{search_id}/run`.
The default limit is 20, with provider bounds of 1–500. Responses preserve
`data`, `source_type`, `has_more`, and available exhaustion/quota metadata.
Each call advances the provider's iterator; the adapter never fetches another
page automatically. An interrupted request may already have advanced it.
Authorize the exact search ID and volume, retain the ID under its connection,
and request another page deliberately. Do not replay it as an ordinary GET.
[Iterator contract](https://developers.clay.com/api-reference/search/run-the-query-mode-iterator-and-return-the-next-page-of-results).

Local validation caps query text at 16,000 characters and search IDs at 1,024
ASCII letters, digits, underscores or hyphens. It does not reimplement Clay's
query grammar. API keys stay in the header on the fixed `api.clay.com` origin;
returned links and input values cannot select another credential destination.

## Application credentials and automation

This API-key flow has **no OAuth callback**, so there is no universal callback
URL to register for Clay. VM addresses and custom application domains do not
change its authentication.

The application owner supplies its authorized Clay key through private Env.
Two keys alone do not establish separate quota or billing pools; confirm the
provider's capacity terms. The application must not silently substitute an
unrelated Clay workspace for the customer's. See the
[application setup contract](../../connectors-core/docs/online-setup.md).

AI can generate the portable file, environment wiring, query operations and
tests. The documentation reviewed exposes key creation through the console,
not a verified public provisioning API. Account access, key issuance and any
required provider plan approval remain operator actions. A bootstrap script
must not pretend those actions have been automated.

## Routines and table queries

For custom functions, open [Functions](https://app.clay.com/functions), create or
select a function, open **Details**, enable **API**, and copy its `t_...` function
ID. Prefix it with `function:`. Supply the exact inputs defined by that function.
For Clay-managed routines, use the published routine ID and input contract from
[Clay-managed functions](https://developers.clay.com/routines/clay-managed-functions).
There is no public routine-discovery operation in this adapter.

```js
const run = await connections.invoke({
  context, integrationId: "prospects", operation: "routines.run",
  input: { routineId: "function:t_example", items: [
    { id: "row-1", inputs: { domain: "example.com" } }
  ] }, signal
});
// Persist run.routine_run_id under this connection. Later, explicitly poll:
const progress = await connections.invoke({
  context, integrationId: "prospects", operation: "routines.results",
  input: { routineId: run.routine_run_id, limit: 20 }, signal
});
```

The results operation's `routineId` is the **run ID returned by the start request**,
not the function ID. Starts accept 1–100 items with caller-owned IDs (1–64 chars)
and an optional existing `webhook_id`. The adapter does not register webhooks.
An `in_progress` response is not success for the enrichment; preserve status,
progress, each item's output/error and any cursor. Run completion does not mean
all items succeeded. No automatic polling, pagination or replay is performed.
Authorize exact inputs, routine and volume; runs can consume credits. The optional
`credits.balance` read reports current balance, not a price quote or reservation.
After an uncertain start, investigate in Clay before repeating it: no idempotency
guarantee is claimed. [Routine API](https://developers.clay.com/routines/api),
[function exposure](https://developers.clay.com/routines/custom-functions).

`tables.query` requires **Enterprise** and known table IDs. Open the target Clay
table and copy the ID after `/tables/` in its URL. No public list-tables endpoint
exists. For example:

```js
await connections.invoke({ context, integrationId: "prospects", operation: "tables.query",
  input: { query: { tables: [{ id: "t_example" }], field_mode: "names",
    select: [{ field: "Domain", as: "domain" }],
    filter: { field: "Domain", op: "is_not_empty" }
  }, limit: 20 }, signal });
```

The adapter validates the query envelope, known top-level fields, table IDs,
collection bounds and a limit of 1–100. Clay validates its provider-owned nested
filter/select/join/order grammar; the adapter does not translate SQL or invent
fields. Use [Clay's table query guide](https://developers.clay.com/tables)
for exact field and filter syntax. Returned data, field metadata, cursor and
`truncated` are preserved. Scans can repeat records updated during pagination:
deduplicate by record ID. Grouping/aggregation/custom ordering cannot always
produce cursors; `truncated: true` without a cursor requires narrowing the query,
not treating that response as the full dataset.

Current query-mode handles search criteria; legacy filters-mode is deprecated
and is intentionally absent. Native frameworks can use these same fixed Public
API endpoints with `clay-api-key` from private Env and their own HTTP client;
JSKIT and Vibe64 are not required for execution.

## Focused proof and limitations

Controlled HTTP tests with real temporary file state cover verification, restart,
rotation, ownership, search paging, routine start/progress/item errors, table
queries/truncation, invalid input, denied writes, billing/rate/provider failures,
and interrupted iterators without replay. The rendered editor check covers the
Public API key label, raw-secret rejection, reference persistence, function API
enablement, Enterprise prerequisite and local-disconnect explanation.
No live provider calls or generated applications are part of this proof.

**LIMITATIONS:** Automatic Vibe64 coding-assistant attachment is deferred. For
example, saving Clay here does not let you ask the Vibe64 chat to enrich leads;
the generated app or explicitly wired assistant host can invoke these operations.
Clay's workflow/function authoring UI, large JSONL batch uploads, webhook
provisioning/verification and automatic key issuance remain provider/native app
work. For example, create and enable a custom function in Clay first; this adapter
can run it but cannot build it from a canvas. HTTP 402 is a sanitized provider
failure, never a successful empty search. Key-dialog instructions follow official
docs; no signed-in console or paid-plan capability was verified.
