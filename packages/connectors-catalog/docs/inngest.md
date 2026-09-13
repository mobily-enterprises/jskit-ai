# Inngest

Import `inngestProvider` from `@jskit-ai/connectors-catalog/server/inngest`.
This fragment sends one explicitly authorized event and reads registered app
and function metadata. The UI edits the same portable configuration as a CLI.
It supports shared and assistant accounts, using the owner's credentials.

## Manual setup

1. Sign into Inngest Cloud and select the intended environment using the
   environment selector.
2. Click the adjacent key icon, choose **Event keys**, then **+ Create Event
   Key**. Set a descriptive name, choose **Save changes**, and use **Copy**.
   Apply event-name/IP restrictions appropriate to the application's events.
3. Store that value in the backend environment as `INNGEST_EVENT_KEY`. Enter
   `env:INNGEST_EVENT_KEY` in the editor's **Event Key reference** field.
4. In the intended environment's **Signing Key** tab, copy its Signing Key.
   Store it as `INNGEST_SIGNING_KEY` and enter `env:INNGEST_SIGNING_KEY` in
   **Signing Key reference**. The two keys have different purposes.
5. Leave **Branch environment (optional)** empty for ordinary delivery. For
   branch delivery, enter the intended branch identifier. This field only
   affects event delivery, not metadata queries.
6. Save configuration. Choose **Set credential in Env** to save
   `INNGEST_SIGNING_KEY`; under **Inngest Event Key**, choose **Set credential in Env** to save
   `INNGEST_EVENT_KEY` separately.
   Save both values in backend Env, return, and choose **Connect account**.
   This verifies metadata only. Separately implement and register the
   application's workflow functions using Inngest's SDK.

[Event Key creation](https://www.inngest.com/docs/events/creating-an-event-key),
[Signing Key configuration and rotation](https://www.inngest.com/docs/platform/signing-keys).
Both keys remain secrets. Changing a signing key also affects any application
serve endpoint using it; coordinate SDK rotation independently of this connector.

## Configuration and runtime

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "workflows": {
      "provider": "inngest",
      "displayName": "Report workflows",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:INNGEST_SIGNING_KEY"
      },
      "settings": {
        "eventKeyRef": "env:INNGEST_EVENT_KEY"
      }
    }
  }
}
```

The required `eventKeyRef` uses the core's secret-reference grammar. Optional
`branchEnvironment` accepts 1–255 printable ASCII characters without spaces.
Strings use shared schema normalization. Clearing the branch removes it from
the file. Changing either reference or the branch requires verification again.

Compose the provider with the [API-key file-runtime pattern](../patterns/api-key-connection/PATTERN.md).
The existing connection owner handles authorization, environment resolution,
file persistence and disconnect. No database or Vibe64 server is required by
the CLI. The [event-delivery pattern](../patterns/event-delivery/PATTERN.md)
adds application-owned event authorization and explains the workflow boundary.

| Operation | Input | Effect |
|---|---|---|
| `apps.list` | Optional `limit` 1–100, `cursor`, `archived` | Read one app metadata page; defaults to 20 and excludes archived apps. |
| `functions.list` | Required `appId`; optional `limit` 1–100 and `cursor` | Read one function metadata page for that app. |
| `events.send` | Required `name` and object `data`; optional `id`, `ts`, `v`, object `user` | Send one event, which may start registered workflows. |

`connectApiKey` calls `apps.list` using the Signing Key as a bearer credential.
It validates the metadata page before recording a grant. It does not send a
test event, resolve the Event Key, prove the two keys belong to the same
environment, or prove a workflow exists. An empty app list is valid.

Metadata uses `https://api.inngest.com/v2/apps` and the app's `/functions`
endpoint. These endpoints are marked beta in the reviewed
[official v2 schema](https://api-docs.inngest.com/api-specs/v2.json).
The provider preserves `data` and `page`, including opaque cursors; requesting
another page is explicit. Inngest also offers separate v2 API keys, but this
initial form models the application Signing Key and Event Key pairing.
[REST authentication](https://api-docs.inngest.com/authentication).

`events.send` resolves the Event Key only after application authorization and
sends JSON to `https://inn.gs/e/<encoded-key>`. It removes the Signing Key header
and adds `x-inngest-env` only when a branch is configured. Redirects are rejected;
the caller cannot supply an alternative destination. The normal Event API is
used, rather than the low-volume v2 event debugging endpoint.
[HTTP event delivery](https://www.inngest.com/docs/events).

This fragment accepts one event, not a batch. It bounds names to 255 characters,
IDs to 512 and versions to 255; `ts` must be integer Unix milliseconds from
1980 onward within JavaScript's safe-integer range. Unknown fields and invalid
objects are rejected before HTTP. Application policy receives the event input
before credentials are resolved. It must authorize the event name, payload and
tenant, not merely membership in the shared connection.

A successful result requires status 200 and one nonempty event receipt ID.
That receipt acknowledges delivery, not successful workflow execution. There
are no automatic retries. A timeout or cancellation can occur after remote
acceptance, so the application must reconcile before resending. A stable event
`id` can help Inngest deduplicate function runs within its documented 24-hour
window; include the event type and business operation in that identifier.
[Event IDs and deduplication](https://www.inngest.com/docs/events#deduplication).
Provider failures return safe connector errors without credentials or provider
response text. Local disconnect neither deletes the provider keys nor cancels
accepted workflow runs.

## AI automation and application ownership

AI can prepare configuration, reference bindings, JSKIT composition, event
payloads and SDK function code. An authorized operator can automate supported
management tasks through the [Inngest CLI](https://www.inngest.com/docs/cli) and
v2 API after credential bootstrap. The reviewed schema exposes environment
creation and app metadata operations; that does not establish automated account
signup or initial credential issuance. Use the dashboard steps above for the
initial keys and validate the current API before adding provisioning calls.

The application owner supplies its Event and Signing Keys through private Env.
These are not OAuth registrations. Separate Event Keys support independent rotation and
attribution, but labels or environments do not establish independent billing
or quota pools. The application owner must obtain
the provider capacity it needs. Signing Keys belong in the application backend,
never the editor binary or browser bundle.

No OAuth callback is involved. The editor VM and published app can have different
domains. If the app hosts Inngest functions, its SDK endpoint/worker registration
belongs to that deployed app and must be configured separately. Self-hosted
Inngest endpoints, OAuth, function registration, schedule management and run
cancellation are not implemented by this fragment.

## Focused proof

Nine provider tests use simulated HTTP replies and actual temporary encrypted
JSON files. They cover metadata verification, separate credential destinations,
encoded Event Keys, branch delivery/removal, payload policy, malformed replies,
pagination, rotation, ownership, restart, disconnect and cancellation without
replay. Editor tests cover both references, branch validation, reload and
optional-field removal. Live provisioning, event delivery, workflow execution
and generated sample apps are excluded from this proof.

Credential creation and signing-key instructions were rechecked against current
official documentation on 2026-09-12. The screen now explains both Env entries,
the optional branch and the limits of connection verification. Updated rendered
review passed with simulated connection responses; no live event has been sent.

## Native functions and scheduled work

The [event-delivery pattern](../patterns/event-delivery/PATTERN.md#native-functions-and-cron)
now includes an app-owned function and cron composition using the current native
Inngest SDK. Install that SDK in the application only when it hosts functions;
the connector package does not acquire a workflow-engine dependency.

Deploy the native serve handler at the application's `/api/inngest` route. Set
`INNGEST_SIGNING_KEY` from the same intended environment so the SDK validates
Inngest requests; do not replace signature verification with a public unguarded
business action. Other frameworks use a supported native SDK/serve adapter. If
none exists for that framework, event submission still works, but a separate
supported function host is an explicit application choice, not a JSKIT sidecar.

In Inngest Cloud select the environment, open Apps, choose Sync App / Sync New
App, enter the deployed HTTPS serve URL and Sync App. After function changes,
open that app and Resync. If the domain changes use Override for the new URL,
keeping the same SDK app ID. The editor does not perform this deployment/sync.
[Sync guide](https://www.inngest.com/docs/apps/cloud), reviewed 2026-09-13.

**LIMITATIONS:** No automatic SDK installation, function generation/deployment,
provider app sync, workflow dashboard, run cancellation or self-hosted endpoint
mode. Example: an app can submit a report event, but a report only runs after
its own SDK function is deployed and synced. Schedule execution and SDK business
functions are native application composition, not tested live or through a
generated app here. Editor-assistant attachment is deferred. The connector's
metadata check does not prove the Event Key or function availability.
