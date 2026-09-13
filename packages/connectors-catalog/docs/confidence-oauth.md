# Confidence MCP setup and ownership

The Flags and Experiments adapters use separate integration IDs and MCP paths.
They share an OAuth issuer and `registerConfidenceClient`, exported through
either provider entry point. Both support assistant ownership only.

## Account and manual setup

1. Sign into the intended Confidence account and confirm access to the target
   organisation. The provider's account policy remains authoritative.
2. Add **Confidence Flags** or **Confidence Exp** in Vibe64. These configure an explicitly wired assistant host; automatic Vibe64 chat
   attachment is deferred. They do not configure production flag evaluation.
3. Confirm the suggested callback is the exact route served by that host and
   choose identity/profile/email/refresh permissions. In development, the owner
   can choose **Register client and connect**: the existing project registration action
   saves the client ID to configuration and secret/callback/recovery ID to Env.
   Existing Env values are preserved. Investigate any uncertain failure before
   repeating it. The application must still implement its callback/setup command.
4. For manual or standalone CLI setup, send the displayed registration JSON to
   the fixed endpoint using POST and Content-Type application/json, or call
   `registerConfidenceClient` below. Copy `client_id` to configuration and store
   `client_secret` and the exact callback in private Env. No manual OAuth
   client-creation console is established by the reviewed docs. Changing scopes
   in a saved file does not update a previously registered client.
5. The host calls `beginAuthorization` and opens its URL. Sign in at the
   provider prompt and allow the connection. Complete the callback under the
   same authenticated assistant owner. Verification lists tools only.
6. Discover tool schemas and configure host policy for their names, arguments,
   target resources and effects. Do this before exposing calls to an AI.

The provider documents Streamable HTTP MCP at `/mcp/flags` and
`/mcp/experiments`, with browser authentication. Flags include management tools;
experiments include analysis and result retrieval. Its separate documentation
MCP is unauthenticated and not part of either adapter.
[Confidence MCP guide](https://confidence.spotify.com/docs/sdks/mcp-servers).

## Automation and provider registration

On 9 September 2026, public
[OAuth metadata](https://mcp.confidence.dev/.well-known/oauth-authorization-server)
advertised issuer `https://mcp.confidence.dev`, `/authorize`, `/token`, `/register`,
S256, code/refresh grants and `none`/`client_secret_post`. The
[resource metadata](https://mcp.confidence.dev/.well-known/oauth-protected-resource/mcp)
declared resource `https://mcp.confidence.dev/mcp` for both paths.

The documents differ on permissions: authorization metadata lists `openid`,
`profile`, `email`, `offline_access`; resource metadata instead lists `flags:read`
alongside the three identity scopes. This fragment exposes the authorization
server's four scopes. It does not claim a verified `flags:read` grant or infer
that any identity scope restricts tool calls to reads. Live consent acceptance
remains untested.

Unauthenticated MCP challenges advertised HTTP discovery addresses. This
implementation pins the independently verified HTTPS issuer/resource and never
follows those HTTP addresses or a replacement authentication URL from an error.

An authorized operator or AI setup process can call:

```js
const client = await registerConfidenceClient({
  clientName: "My assistant",
  callbackUrl: "https://assistant.example/connections/confidence/callback",
  scopes: ["openid", "profile", "email", "offline_access"]
});
```

The helper uses the MCP SDK to POST one exact callback, code/refresh grants,
`client_secret_post` and the chosen scopes to `/register`. It validates returned
client/redirect metadata and returns `clientId`, `clientSecret` and any
`clientSecretExpiresAt`. Store that result through existing privileged owners;
never log or return the secret through ordinary UI status.

For manual HTTP setup, send JSON to `https://mcp.confidence.dev/register` with
`client_name`, `redirect_uris: [callback]`,
`token_endpoint_auth_method: "client_secret_post"`,
`grant_types: ["authorization_code", "refresh_token"]`,
`response_types: ["code"]` and space-delimited `scope`. HTTPS and HTTP loopback
callbacks are accepted by the helper; credentials, query and fragments are
rejected. It neither follows redirects nor retries registration. An interrupted
request may already have created a client; inspect before retrying.

This is different from **Admin → API Clients**, which creates management API
credentials, and from flag client secrets used by evaluation SDKs. Those are not
MCP browser consent credentials.
[Management API quickstart](https://confidence.spotify.com/docs/api/quickstart),
[flag client credentials](https://confidence.spotify.com/docs/api/how-to-guides/flags/setup-flag-clients).
An AI can prepare this setup and perform explicitly authorized API requests.
It cannot complete human consent or remove provider account requirements.

## Runtime and CLI contract

Compose the existing `oauth-connection` and `assistant-mcp-oauth` patterns with
the selected provider and the provider guide's `integrations.json`. CLI and UI
use the same parser. All four scopes are initially selected; `openid` is needed
by both initial operations. The host resolves secret references and chooses
encrypted file storage. No database is required.

`tools.list` accepts a cursor and returns one page. `tools.call` accepts `name`
and `arguments`; discover their current schema rather than inventing fields.
The host's `authorize` callback must validate resource ownership and approve
each operation. Handle `isError` as a tool failure. Tool output, descriptions and
linked documents do not grant further authority. No automatic paging, retries,
polling, tool attachment or flag changes occur.

Each configured integration keeps a distinct grant even when both use one
registration. Changing a provider ID cannot reuse another integration's grant.
The provider's common OAuth resource is not an application-side permission
boundary. Disconnect removes the local grant and does not undo completed work.
This library does not use these identity scopes to implement application login.

## Connection ownership and callbacks

This fragment is for an explicitly configured assistant host. That host owns its
client registration, callback, private credentials and grants; it may be an
application-owned assistant or an opt-in editor tool. Merely adding the provider
to a project does not authorize the editor's coding assistant. It does not supply
published app-user login. The host's callback may differ from the published app's
domain, but it must match that host's real route and registered redirect URI.

Flags and Experiments each register the host's real callback with the appropriate
provider endpoint. Keep their registrations, Env references and grants distinct.
On a host/domain change, update registration and callback Env when the callback
changes, while retaining the owning runtime identity and persistent grants.
Separate client IDs do not establish separate provider quotas or organisation
entitlements. Registration acceptance and commercial use need provider proof.
The editor exposes explicit automatic or manual client registration and the
application-owned connection lifecycle. Live provider registration and consent remain unverified.

## Evidence

Controlled tests exercise both MCP paths, common resource binding, confidential
registration, file ownership and restart, refresh, exact tool policy, malformed
responses, permission errors, cancellation and no request replay. Provider guide
JSON and responsive editor persistence are checked separately. No live provider
account, registration, consent, flag mutation, experiment run, database or
generated application is used. Metadata discovery alone does not prove live
registration or token acceptance.
