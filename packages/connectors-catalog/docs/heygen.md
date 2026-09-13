# HeyGen

Import `heygenProvider` from `@jskit-ai/connectors-catalog/server/heygen`.
This fragment uses the v3 API to read the current profile and voice catalogue.

## Configure access

1. Sign into the intended HeyGen account. Open the
   [API dashboard](https://app.heygen.com/home?from=&nav=API), also linked from
   the provider guide, and generate an API key.
2. Restrict the key to `account:read` for profile verification and `voices:read`
   for voice listing. Copy it into backend Env as `HEYGEN_API_KEY`. API-key billing and
   subscription OAuth are separate arrangements; use a key for the REST mode.
   [Key setup](https://developers.heygen.com/docs/api-key).
3. Save provider `heygen`, mode `shared` or `assistant`, `scopes: []`, and
   authentication `{ "method": "api-key", "secretRef": "env:HEYGEN_API_KEY" }`.
4. In the screen, Save configuration, choose Set credential in Env, save the
   actual key as `HEYGEN_API_KEY`, then return and choose Connect account.
   CLI applications run `connectApiKey`. The verifier calls `GET /v3/users/me`, which returns
   profile and billing fields under `data`. Replace the provider key in Env
   when rotating it; local disconnect does not revoke remote access.
   [Profile endpoint](https://developers.heygen.com/reference/get-current-user).

## Runtime and AI composition

`profile.read` accepts no inputs. `voices.list` reads `GET /v3/voices` and
accepts `limit` (1–100, default 20), `token`, `type` (`public` by default or
`private`), `engine`, `language` and `gender` (`male` or `female`). Pass the
returned `next_token` as `token` when `has_more` is true. These calls use
`x-api-key` against `https://api.heygen.com`; neither creates speech or video.
[Voice endpoint](https://developers.heygen.com/reference/list-voices).

Use the [API-key pattern](../patterns/api-key-connection/PATTERN.md) with this
provider and the private JSON store. AI-written applications can select voice
IDs from the catalogue; generation, consent to cloning, billing and job handling
remain additional application work. No arbitrary endpoint is accepted as input.

## Automation and application ownership

The verified key bootstrap is the API dashboard. An AI can prepare JSON and
library composition afterwards; this pass does not establish a key-creation API.
The application owner supplies its key through private Env and arranges provider
billing/capacity. Two named keys alone do not create independent budgets.
Subscription provisioning remains provider-owned. Browser OAuth is available through the separate MCP mode below.

Tests cover profile verification, voice filters, paging, defaults, private-file
restart, key replacement, isolation, disconnect and provider errors. They use
simulated responses and do not create media or access a real HeyGen account.


## MCP OAuth connection

The captured Lovable chat connection opened HeyGen OAuth. The current
[MCP guide](https://developers.heygen.com/mcp/overview) still describes browser
OAuth at `https://mcp.heygen.com/mcp/v1/`, drawing on the connected account's
plan. The same provider now exposes that path as OAuth with `tools.list` and
`tools.call`. The runtime rejects cross-method operations before refresh or
transport. Neither current authentication mode is retired.

On 2026-09-12, the MCP host's authorization-server metadata redirected to
`https://api2.heygen.com/.well-known/oauth-authorization-server`. That published
metadata advertises issuer `https://api2.heygen.com`, authorization/token/client
registration at `/v1/oauth/authorize`, `/v1/oauth/token`, `/v1/oauth/register`,
S256, code/refresh grants, resource indicators and identity scopes `openid`,
`profile`, `email`. It supports confidential and public client authentication.
The protected-resource metadata identifies `https://mcp.heygen.com` as the
OAuth resource, distinct from the transport endpoint's `/mcp/v1/` path. The
adapter uses that root resource in authorization and token requests and reuses
the existing MCP transport and method-specific connection lifecycle. No live
client was registered or account connected during this inspection.

To configure the OAuth assistant connection:

1. Select Assistant access and OAuth. Keep `openid`, `profile`, `email` selected.
2. Confirm Suggested callback URL is the route the host will serve. Choose
   Register client and connect: the public editor invokes the fixed-authority
   helper and saves ID, secret and callback in project configuration/private Env.
   Manual fallback: send one POST to the displayed endpoint with its JSON body
   and Content-Type application/json. CLI users can call
   `registerHeyGenClient({ clientName, callbackUrl })`, exported beside the provider.
3. For manual registration, copy `client_id` into Client ID and Save configuration. Use Set credential in
   Env to save `client_secret` under the displayed reference; use Set callback
   in Env to save the exact registered callback. Keep the response private.
4. Return, save and Connect account. Sign into HeyGen and approve consent.
   Verification lists tools and creates no media. The host must authorize each
   tool name and arguments; tools can incur credits and change or delete content.
5. Reconnect repeats consent. Disconnect removes local state, does not undo work
   and does not promise provider-wide revocation.

The application/assistant host owns its registration, callback, Env and grants.
There is no Vibe64 gateway. Ordinary Connect never silently registers a client;
the explicit Register client and connect action uses the existing helper. Metadata
advertises a revocation endpoint, but this adapter's Disconnect remains local;
no provider-wide revocation claim is made. Both credential instruction screens were rendered and reviewed with controlled
connection fixtures on 2026-09-12. Live provider authorization remains untested.

[API-key permission mapping](https://developers.heygen.com/docs/api-key-permissions)
confirms the read scopes required by this REST fragment. Provider keys and MCP
grants remain distinct; do not send one credential type to the other service.

## Media tools and limits

Use `tools.list` to obtain the connected account's current tool names and input
schemas; the [MCP guide](https://developers.heygen.com/mcp/overview) describes
video creation/status, avatars, speech and translation (reviewed 2026-09-13).
The host invokes `tools.call` with the discovered schema, checks `isError`, and
polls the corresponding status tool for asynchronous work. API-key profile/voice
reads are not a substitute for these OAuth media tools. Identity scopes do not
make tool calls read-only: the application must authorize the exact tool and
arguments before calling, and confirm chargeable/destructive operations. Do not
retry an uncertain creation blindly; reconcile its session/job ID first.

**LIMITATIONS:** No editor-assistant attachment, video editor, automatic media-job
worker or API-key media generation is included. Example: an authorized MCP host
can submit a video request and retrieve its status, but this form alone does not
make Codex create a video or render progress. The app owns polling, downloads,
user consent, content rights and credit limits. Fixtures prove transport and
host policy, not actual media generation or current plan entitlement.

CLI Node applications use the same exported provider and registration helper,
JSON and Env without Vibe64. Other frameworks use their native MCP/OAuth client
with those same project-owned configuration values; no JSKIT runtime or Node
sidecar is required. Select tools from discovery rather than hard-coding this
module's example catalogue as permanent provider API contracts.
