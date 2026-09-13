# Gong

Import `gongProvider` from `@jskit-ai/connectors-catalog/server/gong`.
This provider verifies a company API key and reads users, calls, transcripts and statistics. It
implements the access-key form, including the optional company API URL.
OAuth, MCP and write operations remain outside this provider.

## Create credentials manually

1. Sign into Gong as a technical administrator. Open **Admin center → Settings**,
   then **API** in the **Ecosystem** area.
2. Choose **+ Get API key**, name it, and optionally set its lifetime and allowed
   IP addresses. Use the backend's outbound IPs when restricting network access.
3. Choose **Get API key**. Copy the access-key identifier into the editor and
   store its one-time secret as `GONG_ACCESS_SECRET` in the application
   environment. Enter `env:GONG_ACCESS_SECRET` in the secret-reference field.
   In the editor, **Save configuration**, then **Set credential in Env**;
   paste the secret as `GONG_ACCESS_SECRET` and save there. Finish with **Done**
   in Gong only after preserving the secret. Return and choose **Connect account**.
   The secret cannot be retrieved after closing.
4. For later changes, use the key row's actions menu and **Edit**, then save.
   Revocation is available there through **Delete**, its acknowledgement and
   **Delete API**. Local connector disconnect does not revoke Gong's key.
   These controls were updated in August 2026, so older accounts may differ.
   [Key management](https://help.gong.io/docs/receive-access-to-the-api).

The identifier and secret form an HTTP Basic credential. A secret alone, an
OAuth client secret or an OAuth bearer token is not this credential type.
[API authentication](https://help.gong.io/apidocs/introduction-2).

## Portable file and UI fields

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "sales": {
      "provider": "gong",
      "displayName": "Sales team directory",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:GONG_ACCESS_SECRET"
      },
      "settings": {
        "accessKey": "YOUR_ACCESS_KEY_IDENTIFIER",
        "apiBaseUrl": "https://api.gong.io"
      }
    }
  }
}
```

Replace the identifier with the value from Gong. The shared fields expose
**Access key**, **Access key secret reference** and **API base URL (optional)**.
CLI and editor use the same settings schema. The key identifier is required;
the secret remains outside source. Whitespace around pasted settings is trimmed.
Embedded whitespace, control characters and colons are rejected in the identifier.
The local identifier limit is 512 characters, not a claim about Gong's issued
key length.

Omit or clear the base-URL field to save the default `https://api.gong.io`.
This is the origin in Gong's Basic-authentication example.
[Directory example](https://help.gong.io/docs/uploading-calls-from-a-non-integrated-telephony-system).
When the API settings provide a company URL, use that value, for example
`https://company-17.api.gong.io`. Gong also documents customer-specific API
origins in its OAuth integration guide. The adapter accepts the default host or
one DNS label before `.api.gong.io`, using HTTPS, optionally ending with `/`.
Paths, queries, fragments, ports, embedded credentials and unrelated domains
are rejected. This is an explicit fragment boundary; it does not support
arbitrary proxies. Changing the key identifier or host requires verification
again. Requests never fall back to another customer or the default origin.

## Library and AI wiring

Use the [API-key composition pattern](../patterns/api-key-connection/PATTERN.md)
with `providers: [gongProvider]`, the file connection store, an environment
reference resolver and the application's authorization policy. Both
configuration and runtime state can remain text files; the CLI needs no editor
or database process.

```js
await connections.connectApiKey({ context, integrationId: "sales" });
const directory = await connections.invoke({
  context, integrationId: "sales", operation: "users.list",
  input: { includeAvatars: false }
});
```

`users.list` performs `GET /v2/users`. Its optional `includeAvatars` flag defaults
to false, excluding Gong's synthetic employee/support users. It accepts an
opaque `cursor` of 1–8192 characters. Pass `records.cursor` from the previous
response to request another page. The runtime preserves users, record counts
and cursor metadata, returns one page at a time, and does not auto-page or
accept a destination URL in operation input. An empty user list is valid.
The endpoint documents `api:users:read` for OAuth; this fragment uses a company
API key and does not present OAuth scope controls.
[User API](https://help.gong.io/apidocs/list-all-users-v2users).

Default published API limits are company-wide: three requests per second and
10,000 per day. A 429 response indicates throttling. The fragment surfaces a
rate-limit error and does not implement automatic retries or budget allocation.
[API limits](https://help.gong.io/apidocs/introduction-2).
The application's user-directory policy must decide who may invoke this shared
connection; a company API key is not an individual employee's login identity.

## Provisioning feasibility and application registrations

An AI can prepare this JSON, its reference bindings, request code and validation
without accessing Gong. Initial API-key creation remains a technical-admin UI
step: the reviewed public documentation does not establish an API for creating
keys or customer companies. Do not invent such an endpoint. Browser-assisted
setup requires the operator's existing account and any required approvals.

For a future shared OAuth service, Gong's documented registration path is:

1. Request a developer instance through the form linked in its app guide.
2. Open **Admin center → Settings → Ecosystem → API → INTEGRATIONS** and choose
   **Create Integration**.
3. Supply the name, long/short descriptions, two logo sizes and required scopes.
   Supply the callback, privacy, terms, help and authorization-start URLs, plus
   contact emails and organization domains. For directory access choose
   `api:users:read`; leave frontend embedding disabled unless needed.
4. Save and retain the issued client ID and secret for this application. Keep
   the secret in the application backend's private Env.

Gong's OAuth consent is company-wide and does not support user-level grants.
The token response identifies a customer API origin that a future OAuth adapter
must retain with that customer's connection. These registration steps do not
make the current API-key adapter OAuth-capable.
[App registration](https://help.gong.io/docs/create-an-app-for-gong).

Two keys or client registrations do not override company-wide request limits.
The application owns its credential selection and usage policy. Independent
provider capacity requires an
appropriate Gong account arrangement, rather than just a different app name.
Do not supply one operator's company key as a universal connection to other
customers' Gong data. Each company owns its grant and API destination.

This implemented key flow has no callback registration. A separate OAuth
implementation must use the application's actual registered callback and own
its grants. It is not implemented by this key adapter.

## Focused evidence

Seven tests use simulated Gong responses and real temporary encrypted JSON state.
They cover default/customer origins, Basic credentials, file restart, rotation,
ownership, disconnect, host/key changes, unsafe URL rejection, cursor encoding,
avatar selection and failures. The public editor check verifies required keys,
secret references, company URL validation, reload and default restoration.
No live Gong access, account creation or example application execution is used.

## Call analysis and linked deal context

`calls.extensive` returns metadata, participants, available call summaries/topics,
interaction statistics and CRM context at call time and now. Supply `callIds`
(1–100 strings), or an ordered `fromDateTime`/`toDateTime` range with timezone;
optional `workspaceId` narrows the workspace. Preserve every digit of Gong IDs:
use strings, never JavaScript numbers. Pass `records.cursor` back as `cursor`
while retaining the same filters. No automatic paging or media fetch occurs.

`calls.transcripts` uses the same call/date/workspace selection. Join each
monologue's speakerId to parties in the extensive call data; retain sentence
start/end timing. Transcripts or analysis may be absent, processing, deleted or
restricted. An empty result does not prove the account has no calls.

`stats.interaction` takes `fromDate`, `toDate` in YYYY-MM-DD and optional `userIds`.
Dates use Gong's company timezone; the end is exclusive and cannot exceed the
provider's current day. Results apply to calls with Whisper enabled. Missing
metrics are unavailable, not zero. Cursor paging follows the same pattern.

```js
const result = await connections.invoke({ context, integrationId: "sales",
  operation: "calls.extensive", input: { callIds: ["7782342274025937895"] } });
const transcript = await connections.invoke({ context, integrationId: "sales",
  operation: "calls.transcripts", input: { callIds: [result.calls[0].metaData.id] } });
```

Check for empty results before selecting a call. Linked CRM objects/fields are
Gong's existing context; the app can associate a call with its opportunity and
show available deal changes. This does not establish a CRM connection or provide
a standalone all-deal timeline. The app owns joins, reporting and call/CRM access
rules. Company keys must never grant arbitrary visitors company-wide recordings.

`includeMedia: true` explicitly asks Gong for media URLs; default is false.
These URLs expire after eight hours and require corresponding provider access.
Treat them as private capabilities. Never attach the Gong Basic credential when
using a returned media URL. The adapter does not download or archive recordings.

The technical administrator supplies company API access; account verification
only checks users and does not prove call, transcript, media or statistics access.
CLI consumers use the same config and private Env. Other frameworks use native
HTTP Basic against the selected company host and the official
[call-data](https://help.gong.io/apidocs/retrieve-detailed-call-data-by-various-filters-v2callsextensive-2),
[transcript](https://help.gong.io/apidocs/retrieve-transcripts-of-calls-by-date-or-callids-v2callstranscript-2)
and [interaction-statistics](https://help.gong.io/apidocs/retrieve-interaction-stats-for-applicable-users-by-date-v2statsinteraction)
APIs. No Vibe64 runtime or AI service is involved.

**LIMITATIONS:** no CRM synchronization, standalone deal timeline, recording
uploads, media archive, OAuth or editor assistant attachment. Example: an app
can show renewal-call transcripts and the opportunity context already in Gong;
it cannot connect Salesforce for the customer or create missing CRM history.
Real company permissions, transcript availability and media downloads are untested.
