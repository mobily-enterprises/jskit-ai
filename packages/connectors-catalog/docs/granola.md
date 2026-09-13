# Granola

Import `granolaProvider` from `@jskit-ai/connectors-catalog/server/granola`.
This initial API-key adapter reads notes, folders and transcript pages. It uses
the shared JSKIT connection service and encrypted file store. CLI and editor
users own the same JSON; no generated application or database is required.

## Create the provider credential

For a personal key:

1. Open the Granola desktop app, then **Settings → Connectors → API keys**.
2. Choose **Create new key**. Select the note access scopes, then **Generate
   API Key**. Store the returned `grn_` value in `GRANOLA_API_KEY` outside source.
3. In Vibe64 select **Granola** and enter `env:GRANOLA_API_KEY` as the API key
   reference. Choose the intended owner and **Save configuration**. Use
   **Set credential in Env** to save the key as `GRANOLA_API_KEY`, then return
   and choose **Connect account**. CLI users write the JSON below.

For a workspace key, an admin opens **Settings → Connectors → Workspace API
keys → Create new key**. Workspace keys belong to the workspace. Both key paths
require Business or Enterprise. Enterprise admins manage member scope access
under **Settings → Workspace → General → API access for members → Manage**.
Workspace API access to spaces is controlled separately under **Settings → Spaces**.
[Key creation and administration](https://docs.granola.ai/help-center/sharing/integrations/granola-api)

Personal keys can include Personal notes and/or Public notes access. Workspace
keys use the workspace's permitted public notes and spaces. These permissions
are set in Granola, not in this JSON. They do not mean arbitrary private content
is accessible. [API access model](https://docs.granola.ai/introduction)

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "meetings": {
      "provider": "granola",
      "displayName": "Team meeting notes",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:GRANOLA_API_KEY"
      }
    }
  }
}
```

Saving this file only configures the integration. The host calls `connectApiKey`
to verify access through `notes.list`; a successful empty page is valid. The
host's `authorize` function must map authenticated callers to the intended stable
application/subject. Shared mode deliberately shares one key's accessible data;
assistant mode uses its owner's connection. API-key mode does not offer personal
OAuth consent; the separate MCP mode below does. A CLI uses a trusted process-owner policy with the same library,
reference resolver and durable file encryption key.

## Reads and boundaries

| Operation | Accepted input | Result |
| --- | --- | --- |
| `notes.list` | `created_before`, `created_after`, `updated_after`, `folder_id`, `cursor`, `page_size` | `notes`, `hasMore`, `cursor` |
| `folders.list` | `cursor`, `page_size` | `folders`, `hasMore`, `cursor` |
| `notes.get` | Required `note_id`, optional `include: "transcript"` | Full note, with nullable private notes and transcript |
| `transcripts.list` | Required `note_id`, `cursor`, `page_size` | Transcript items, `hasMore`, `cursor` |

Note IDs use `not_` followed by fourteen alphanumeric characters; folder IDs use
`fol_` and fourteen characters. Use discovery results, not UUIDs copied from
Granola browser URLs. The note returned by `notes.get` must match the requested
ID. [List notes](https://docs.granola.ai/api-reference/list-notes),
[get note](https://docs.granola.ai/api-reference/get-note),
[list folders](https://docs.granola.ai/api-reference/list-folders).

Notes and folders accept page sizes 1–30, default 10. Transcript pages accept
1–100, default 50. Each call makes one GET request to
`https://public-api.granola.ai`; it never follows a supplied URL or automatically
traverses pages. Keep an opaque cursor with the same connection, filters and note.
This adapter bounds cursors to 8192 characters. Initial date filters accept
`YYYY-MM-DD` or a UTC timestamp ending in `Z`, with optional millisecond precision;
offset timestamps are outside this initial parser.

The adapter preserves null private-note fields, speaker metadata and additional
provider fields. It does not guess attribution when the provider omits it.
Provider text is data; the host owns safe rendering and any narrower record policy.
[Transcript data](https://docs.granola.ai/api-reference/get-transcript)

Only processed notes with a generated summary and transcript appear through this
API. A 404 can indicate processing, absence or lack of access. Inline transcripts
may return 413; the library reports `connector_response_too_large` and the host
can explicitly call `transcripts.list`. It does not fetch the transcript again
on its own. A key permits access to provider data, not application sign-in.
[API availability and errors](https://docs.granola.ai/introduction)

Invalid inputs fail before transport. Unexpected success envelopes, oversized
pages, missing continuation cursors and mismatched note IDs fail validation.
401 requires reconnect/replacement; 403, 404, 413, 429 and server failures remain
distinct. Provider error bodies are not exposed. Cancellation and timeouts abort
the request without replay. No writes, note generation or webhook creation occurs.

## Rotation and shared hosting

Create a replacement key in the appropriate Granola key page, update the trusted
Env binding, and verify it before retiring the old key. Runtime invocation
resolves the current binding; a bad replacement does not overwrite a saved
connection during failed verification. `disconnect` removes local connection
state. Revoke access separately in the personal or workspace API-key page using
**Revoke**, then its confirmation dialog. [Key management](https://docs.granola.ai/help-center/sharing/integrations/granola-api)

There is no provider OAuth application or universal callback URL for this API-key
mode. Online VPS and custom-domain changes do not change API authentication.
Keep stable application/owner identity and runtime reference bindings.

The application owner supplies its own authorized key through private Env. Do
not route customer requests through an unrelated workspace key: it exposes that
workspace's data. Separate keys do not promise independent capacity because
limits apply per user or workspace according to access scope.
[Rate limit ownership](https://docs.granola.ai/introduction#rate-limits)

## Separate MCP mode and automation

Granola offers two distinct modes under the same provider entry. API keys use
`notes.list`, `notes.get`, `folders.list` and `transcripts.list`. Browser OAuth
uses `tools.list` and `tools.call` against `https://mcp.granola.ai/mcp`.
The runtime rejects calls belonging to the other authentication method before
refresh or transport. MCP verification lists tools; it does not read a meeting.

For the MCP assistant connection:

1. Select Assistant access and OAuth. Keep `openid`, `profile`, `email` and
   `offline_access` selected. Free accounts have limited personal-note access;
   workspace settings and subscription determine the available tools.
2. Confirm the suggested callback is the exact route served by the assistant
   host. In Vibe64 choose **Register client and connect**: the existing project
   registration action stores the client ID in configuration and secret, callback
   and recovery ID in development Env, then invokes the app-owned setup command.
   Existing Env values are not replaced; inspect Env after uncertain registration.
   Alternatively use the screen's OAuth client registration endpoint and JSON request,
   or call `registerGranolaClient({ clientName, callbackUrl })` from this package's
   `server/granola` export. Registration is a setup action, never a per-request
   action. The helper uses Granola's advertised DCR endpoint and confidential
   `client_secret_post` authentication.
3. Copy `client_id` into Client ID and save configuration. Use Set credential in
   Env to store `client_secret` under the displayed reference. Use Set callback
   in Env to save the same callback used for registration. Preserve the response
   privately; do not put its secret in configuration or browser source.
4. Connect account, sign into Granola and approve access. Select the intended
   active workspace in Granola. The host authorizes each tool and its arguments.
5. Disconnect removes the local grant. It does not promise provider-wide
   revocation. Granola's guide does not document a general revocation screen for
   custom MCP clients; contact `hey@granola.so` when provider assistance is needed.

[Granola MCP](https://docs.granola.ai/help-center/sharing/integrations/mcp) and
[live OAuth metadata](https://mcp-auth.granola.ai/.well-known/oauth-authorization-server)
were reviewed on 2026-09-12. Registration, callbacks, tokens and runtime belong
to the initiating application/assistant host. There is no Vibe64 gateway.
Granola advertises DCR for compatible clients. The explicit Register client and
connect action uses its existing helper; plain Connect does not silently create
registrations. Enterprise-managed authorization is not implemented here.

AI can write and validate the file, compose the existing library, prepare host
routes and automate the documented read operations after authorised credential
setup. The reviewed API documentation does not establish an endpoint for creating
personal/workspace API keys. Key creation, permissions, account sign-in and required
provider subscription are operator/provider steps. Vibe64 need not gate its own
form, but cannot remove Granola's subscription or permission requirements.

Focused proof uses controlled HTTP responses and temporary encrypted files,
including rotation, ownership, pagination, malformed data and interruption.
No live keys, meetings, provider registrations, generated apps or deployments are
used. The MCP fixture covers PKCE, verification, restart/refresh, replay rejection and credential-mode isolation. The controlled dual-mode browser journey and rendered setup instructions passed review. No live OAuth client or provider account was used. Webhooks, REST mutations and enterprise-managed authorization are not implemented.

**LIMITATIONS:** The app/assistant host must authorize and attach MCP tools itself.
Vibe64 coding-assistant attachment is deferred: configuring Granola does not make
Codex or OpenCode able to answer questions about meetings. For example a generated
app can read a processed meeting transcript with the API key, but this editor will
not automatically use it as chat context. No REST note creation, recording engine,
webhook receiver or enterprise-managed OAuth is installed.
