# Apify

Import `apifyProvider` from `@jskit-ai/connectors-catalog/server/apify`.
The adapter discovers Actors, starts bounded runs, reads status, requests cancellation,
and retrieves dataset/storage results. Verification only lists Actors; it does not
start runs, create schedules or spend compute credits.

## Set up access

1. Sign in to [Apify Console](https://console.apify.com/settings/integrations).
   Select the account or organization that should own this connection.
2. Open **Settings → API & Integrations** and find the API tokens section.
3. Start creating a token. In **Description**, identify the application. For an
   expiring token, enable **Set expiration date** and fill **Date**.
   A standard token leaves **Limit token permissions** off. It has broad account
   access, including capabilities beyond this adapter's operations; use this
   documented setup only if the application owner accepts that access. Keep the
   token exclusively in the trusted application backend. Choose **Create**, then
   copy the issued token. Do not broaden an existing token just to pass a check.
   A token created under your personal account does not cover organizations
   you belong to. Switch into the organization first for its tokens; organization
   personal tokens inherit the member's access, while organization tokens require
   owner or Manage access tokens permission.
4. Store the token outside application source as `APIFY_TOKEN`. Set the
   configuration slot's provider to `apify`, mode to `shared` or `assistant`,
   scopes to `[]`, and authentication to `api-key` with reference
   `env:APIFY_TOKEN`. In Vibe64, enter that value in **API key reference**, save,
   then use **Set credential in Env** to save the token as `APIFY_TOKEN`.
   This mode has no callback/client registration.
5. Save and choose **Connect account**, or **Verify again** for a connected
   account. **Check connection** only reads its current status. CLI applications
   call `connectApiKey`. Inspect the Actor list for the expected
   account's resources. Revoke/replace the token through the same settings page.
   See [Account settings](https://docs.apify.com/account/settings) and
   [API integration](https://docs.apify.com/integrations/api).

## Scoped tokens and failed checks

The adapter accepts scoped tokens too, but this guide does not establish a
minimum scoped permission set for `GET /v2/actors`. If your policy requires
scoped access, enable **Limit token permissions** and establish Actor-list
access with Apify before connecting. Storage Read alone is not proof of that
access. A 403 during Connect account or Verify again means this read was denied; it does not
prove the token is invalid or should be replaced with a broader token. A 401
requires checking the token value, expiry and revocation. Never put the token
in frontend code or source control.

This guide's documented standard-token path is distinct from unverified
least-privilege configuration. No live token issuance or permission test has
been performed. The connection check remains the same authenticated Actor-list
operation the fragment provides; it does not run Actors or spend compute.

For a scoped token that runs Actors and retrieves output, grant **Run** on the
chosen Actor and allow access to its default run storages. Without that storage
access, a run can succeed while reading its output fails. Review the execution
permission mode: **Full access** gives the running Actor account-wide access;
**Restricted access** can require additional permissions for that Actor's work.
These settings do not establish the separate minimum permission for Actor listing.
See [scoped token execution](https://docs.apify.com/integrations/api#actor-execution).
Disconnecting locally does not revoke the token: revoke it in Apify Console when
provider access must end, including access from other applications using it.

## Runtime and AI composition

`actors.list` calls `GET /v2/actors` with Bearer authentication. Supported inputs
are `limit` (1–1000, default 100), `offset` (default 0), and `desc` (default false).
The list includes Actors the user created or used. The result retains the `data`
envelope and its `items`, `total`, `offset`, `count` and `limit`. The caller
requests subsequent pages. See [List Actors](https://docs.apify.com/api/v2/actors-get).

Use the [API-key source pattern](../patterns/api-key-connection/PATTERN.md)
with this provider. The application authorizer controls who can inspect the
shared Actor list. CLI and UI configuration use the same file and secret
reference; connection metadata uses the existing file-store adapter.

## Provisioning automation and capacity

Once a token exists, an AI can configure this adapter and query the list through
documented APIs. This pass did not verify an API for issuing the initial token
with equivalent normal-account permissions; use the console for that step.
Actor creation and run APIs are separate capabilities, not evidence that token
or organization creation can be automated without operator involvement.

The application owner supplies its authorized Apify token and arranges the
account or organization budget. Multiple tokens in one account do not reserve
separate compute credits or concurrency. Private Actors still require explicit
access; a configuration label cannot grant access to another account's resources.

Fixtures cover authentication, pagination, malformed success, input validation,
file-store restart, token rotation, owner isolation, disconnect and 401/403/429.
No real Apify account or Actor was invoked.

## Run an Actor and retrieve its output

Select an Actor ID from `actors.list`, or an explicitly chosen Store Actor using
`owner~actor-name`. Call `actors.get` with `{ actorId }` to inspect it. Review the
Actor's own input documentation and price before submitting: Actor inputs and
pricing vary; a token does not make every Actor free or accessible.

```js
const started = await connections.invoke({ context, integrationId: "scraper",
  operation: "runs.start", input: { actorId: "owner~actor-name",
    input: { query: "your actor-specific input" }, timeout: 120, maxTotalChargeUsd: 1 } });
const runId = started.data.id;
const current = await connections.invoke({ context, integrationId: "scraper",
  operation: "runs.get", input: { runId } });
```

`runs.start` requires an Actor-specific JSON `input`, a timeout of 1–86400 seconds,
and an explicit positive `maxTotalChargeUsd` (minimum 0.01). Optional `build`
selects a version/tag. The adapter requests immediate return and disables
restart-on-error. Persist `data.id` before subsequent work. Provider minimum
charges or account policy can still reject a requested cap.
[Start a run](https://docs.apify.com/api/v2/acts-runs-post).

Poll `runs.get` on a bounded application schedule. `READY`/`RUNNING` are not
completion; inspect `SUCCEEDED`, `FAILED`, `TIMED-OUT`, and `ABORTED`, retaining
`statusMessage` for useful diagnostics. `runs.abort` takes `{ runId }` and requests
graceful cancellation. An `ABORTING` response remains pending; check status again
rather than immediately claiming cancellation finished. A lost start response has
an uncertain outcome: inspect the account's runs before creating another paid run.
[Read status](https://docs.apify.com/api/v2/actor-run-get),
[abort](https://docs.apify.com/api/v2/actor-run-abort-post).

For results, use `data.defaultDatasetId` from the run with `datasets.items`:
`{ datasetId, offset: 0, limit: 100 }`. It returns JSON items. Advance offset by
the received count until a short page after the run finishes. No cleaning or
unwinding is applied, so pagination reflects raw items. A running Actor can append
items; an empty page before completion does not establish final completion.
[Dataset items](https://docs.apify.com/api/v2/dataset-items-get).

Use `data.defaultKeyValueStoreId` with `stores.record` and `{ storeId, key }`,
for example `key: "OUTPUT"` where that Actor documents OUTPUT. It returns
`{ contentType, bodyBase64, size }` for JSON, text or binary records. Decode
`bodyBase64` in the application; serve downloads with the application's own access
checks and safe content-disposition policy. This bounded operation rejects records
over 8 MiB; larger files require the framework's native streaming client. It does
not follow provider redirects with credentials.
[Stored record](https://docs.apify.com/api/v2/key-value-store-record-get).

Authorize every run, cancellation and storage read against the application's
owner and chosen resources. Connection success does not prove run or storage
permission for every resource. The inline token guide retains the distinction
between standard-token access and scoped permissions whose exact role mapping
has not been live-verified. Surface denied permissions without silently replacing
a restricted token with an unrestricted one.

`test/apify.test.js` passes the actual connection-service workflow using controlled
responses: actor selection, explicit budget/timeout, run terminal states, pending
cancellation, dataset pagination, JSON/binary storage, 8 MiB bound, input and
owner rejection, 403/429 and uncertain submissions without automatic retries.
No live Actor or paid account operation was performed.

## Limitations

Vibe64 coding-assistant attachment is deferred. For example, the generated app
can start an authorized scraper, show run progress and read the resulting dataset,
but asking Vibe64's Codex/OpenCode assistant to scrape a site does not grant it
access to this connection. The app composes its own input screen, bounded status
polling and output presentation. This connector does not create Actors or schedules.
Records over 8 MiB use the framework's native streaming client. Live token issuance,
scoped permission checks and generated-app execution were not exercised.
