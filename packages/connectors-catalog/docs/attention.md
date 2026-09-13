# Attention

Import `attentionProvider` from `@jskit-ai/connectors-catalog/server/attention`.
This adapter verifies an organization key by listing conversations, then provides
explicit conversation, coaching and organization operations.

## Manual provider setup

1. Sign into [Attention](https://app.attention.tech) as an organization admin.
   Open the profile avatar at the top left, then **Settings**.
2. Under **Organization**, select **API Keys**. Choose **+ Create API Key**
   and enter a descriptive name.
3. Copy the key from **API Key Created**; it is shown only once. Put it in the
   backend environment as `ATTENTION_API_KEY`.
4. Add Attention in Vibe64 and enter `env:ATTENTION_API_KEY` in **API key
   reference**. Save, choose **Set credential in Env**, save the value there, then return and
   choose **Connect account** or **Verify again**. **Check connection** only reloads
   status; it does not validate a newly entered key.
5. For rotation, create a replacement, update the binding and verify before
   deleting the old key through its **⋯ → Delete** menu.

The dedicated authentication guide requires `Authorization: Bearer <key>`.
Generated endpoint examples show a generic Authorization placeholder; this
adapter follows the explicit authentication guide.
[Authentication and dashboard instructions](https://docs.attention.com/api-authentication).

## Portable configuration and runtime

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "calls": {
      "provider": "attention",
      "displayName": "Sales conversations",
      "accountMode": "shared",
      "scopes": [],
      "authentication": { "method": "api-key", "secretRef": "env:ATTENTION_API_KEY" }
    }
  }
}
```

Compose `providers: [attentionProvider]` with the
[API-key pattern](../patterns/api-key-connection/PATTERN.md), an application
authorization policy and the file connection store. Configuration and runtime
state are text files; no editor-specific service or database is required by
the CLI application.

```js
await connections.connectApiKey({ context, integrationId: "calls" });
const page = await connections.invoke({
  context, integrationId: "calls", operation: "conversations.list",
  input: { page: 1, size: 20, "filter[title]": "Review", detailedTranscript: false }
});
```

Requests use `GET https://api.attention.tech/v2/conversations/list`, the current
optimized listing. Pages start at 1 and the provider limits page size to 50.
This endpoint can include empty conversations and omits some extracted CRM
intelligence by default. Results contain `data`, with `links` and `meta` where
available. Title filtering is a case-insensitive partial match.
[Conversation listing](https://docs.attention.com/api-reference/conversation/list-conversations-optimized).

This fragment defaults to page 1, size 20 and `detailedTranscript: false`.
It accepts optional `filter[title]` up to 500 characters and
`filter[hide_internal]` as a boolean. The page cap of 100000 and title bound
are local choices. Additional list date/team filters and CRM expansion are not implemented;
retrieve one conversation for full content. False for detailed transcripts does not mean the result
contains no transcript content; authorize access to the conversation data.

The adapter checks the collection and any available numeric page metadata,
preserves other fields and accepts empty results. It never follows returned
URLs with credentials. Call the named operation with the next page number
explicitly. Keys are resolved per request, sent to the fixed HTTPS origin and
excluded from source. Disconnect removes local state and does not revoke a
provider key. Provider user identities do not establish an application login.

## API provisioning and application ownership

Attention documents `POST https://api.attention.tech/v2/api_keys` with required
`name` and boolean `orgLevel`, authenticated by an existing credential. Its
response includes the generated key in `value`. An authorized administrator
can issue a key named for the application, store the response directly in its
private Env and save only the reference in configuration.
Initial organization access and the bootstrap credential remain prerequisites.
[Key-creation API](https://docs.attention.com/api-reference/api-key/create-api-key).

An AI can prepare that provisioning request and runtime/configuration wiring.
The normal conversation adapter deliberately exposes no key-creation action:
provisioning belongs to the authorized operator and must not return new secrets
through an ordinary conversation response. This documented automation route
has not been exercised with live credentials.

Separate keys support independent revocation but do not prove independent
organization capacity. The authentication guide directs organizations to their
account manager for rate-limit increases. The application owner must verify
provider capacity arrangements for its usage. Each
customer organization supplies its own authorized key. No OAuth callback is
used, so VM subdomains and deployed app domains do not change this flow.

## Focused evidence

Simulated protocol tests with real temporary JSON state cover the bearer header,
current endpoint, title encoding, page bounds, detailed-transcript selection,
partial metadata, empty results, failures, ownership, restart, rotation and
disconnect. The editor check verifies reference-only saving and reload.
Live provider requests, key provisioning and sample-app generation are excluded.

## Complete app workflows

The provider's [OpenAPI contract](https://docs.attention.com/api-reference/openapi.json)
was inspected on 12 September 2026. All paths below are relative to
`https://api.attention.tech/v2` and use the same backend-only Bearer key.

| Operation | HTTP path | Input and result |
|---|---|---|
| conversations.get | GET /conversations/{id} | Detailed transcript defaults true; preserves participants, timing, processing status, scorecard results and intelligence. Optional `by: external_id` and metadata flags. |
| conversations.update | PUT /conversations/{id} | Explicit title and/or labels; omitted fields remain untouched. Labels may replace existing metadata: read before replacing. |
| conversations.archive | DELETE /conversations/{id} | Archives the selected call. |
| conversations.import | POST /conversations/import | HTTPS mediaURL and userID; optional title, external source ID/name, timestamp and calculation/export skip flags. Returns a UUID; transcription/analysis may still be pending. |
| snippets.create | POST /snippets | user_uuid, conversation_id, video start_time/end_time in seconds; internal and notify_views must be chosen explicitly. Returns a link; does not open/fetch it. |
| analysis.ask | POST /ask_attention/v2 | prompt, conversations_ids and deal_id (empty string when not filtering by deal). Preserves each answer's source conversation and error; check errors before displaying success. |
| scorecards.list / scorecards.get | GET /scorecards, /scorecards/{id} | Browse templates; preserve returned criteria and identifiers. |
| scorecardItems.list | GET /scorecards/{id}/items | Page through scoring criteria and their provider-defined ranges. |
| scorecards.summary | POST /scorecards/summary | Required ISO fromDateTime/toDateTime, scorecardUUID, scorecardsItemsUUIDs, teamUUIDs and userUUIDs. Empty filter arrays are passed explicitly. |
| scorecardResults.create | POST /createScorecardResult | conversation_uuid, scorecard_uuid, summary and items (scorecard_item_uuid, description, optional integer numeric_result). Choose scores using that template's ranges. |
| users.list / roles.list / teams.list | GET /organizations/users, /organizations/roles, /organizations/teams | Organization discovery; optional teamUUID for users. |
| users.create | POST /organizations/users | email, first_name, last_name, roleUUID, teams with uuid/optional primary; explicit seat_type listener or recording. |
| users.update | PATCH /organizations/users/{id} | Sparse firstName/lastName, roleUUID, seat_type, teamUUIDsToRemove and teamsToAdd. Provider creation/update field spellings differ. |
| users.delete | DELETE /organizations/users/{id} | Permanent organization-user removal and loss of access. Empty successful response; no automatic retry. |
| teams.create / teams.update | POST /organizations/teams, PATCH /organizations/teams/{id} | Name and optional parentTeamUUID; update sends only selected changes. |

For a coaching dashboard, list calls, retrieve the chosen call with
`conversations.get`, inspect transcriptStatus, and display the returned transcript,
participants and existing scorecardResults. Load templates/items before submitting
reviewer scores; fetch summaries for trends. A successful import UUID is not a
completed recording. Poll its detail explicitly while processing is pending.

The application must authorize organization management separately from viewing
calls. Seat assignment, media import and AI analysis can consume the customer's
provider allowance. Creating users is not an app login mechanism. No provider
operation runs when saving configuration. Writes are never retried automatically:
a lost response may mean the mutation succeeded. Inspect the provider before
retrying imports, snippets, users or scorecard results.

The same `integrations.json`, Env reference and API-key composition work from CLI
without Vibe64. Other frameworks use their native HTTP/client, secret storage and
application authorization against these endpoints; they need no Node service.

## LIMITATIONS

Editor coding-assistant attachment is deferred. For example, an app can display
a sales-call transcript and save a manager's coaching score, but configuring this
connector does not let Vibe64's Codex/OpenCode read those calls from editor chat.
The app owns its dashboard, permissions, polling and handling of pending/error
results. This does not supply Attention's recorder, CRM installation, webhooks,
SCIM, scorecard-template designer or per-user OAuth. Media imports use an accessible
HTTPS file URL; custom fetch headers and precomputed transcript imports require
native provider wiring. Public snippet sharing is an explicit caller choice.
No real organization, live recording, billing action or generated app was exercised.
