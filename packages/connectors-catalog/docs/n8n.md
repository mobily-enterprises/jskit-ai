# n8n assistant MCP connection

Import `n8nProvider` from `@jskit-ai/connectors-catalog/server/n8n`. Configure
`accountMode: "assistant"`, `authentication.method: "api-key"`, an environment
`secretRef`, empty `scopes`, and `settings.serverUrl`. The shared validator
requires a final HTTPS endpoint ending `/mcp-server/http`; installation paths
and explicit ports are retained. Display name is the common integration field.

## Manual setup

1. Open **Settings → Instance-level MCP** as an owner/admin and enable access.
2. Open **Connection details → Connect → API key**. Copy **Server URL** and the
   personal token into the URL setting and secret environment respectively.
   Older releases label the token tab **Access Token**.
3. Review **Workflows exposed** and enable only the intended workflows.
4. Keep `env:N8N_API_KEY` as the reference, select **Save configuration**,
   then **Set credential in Env** for the token. Select **Connect account**
   to verify discovery; the assistant separately authorizes individual tool calls.
5. To expose a workflow, choose **Workflows exposed → Enable workflows**,
   select it and **Enable**, or use its **… → Settings → Available in MCP**.
   Check workflow eligibility and user access. Search may return previews of
   other workflows visible to that user; exposure is not isolated per client.

Use the [n8n setup guide](https://docs.n8n.io/connect/connect-to-n8n-mcp-server)
for version-specific screens and token rotation. A REST API key is a different
credential. Rotating this personal token revokes its predecessor.

## Runtime and ownership

`connectApiKey` performs initialization and `tools/list`, never a workflow call.
`tools.list` accepts an optional opaque `cursor`; `tools.call` requires `name`
and an `arguments` object. Results retain MCP content, `isError`, tool schemas
and pagination. Tool errors are data; protocol/HTTP failures use safe connector
errors. No automatic tool selection or execution occurs.

The application policy receives the requested tool and arguments before any
HTTP request. Apply the assistant's delegated authority there, and treat tool
descriptions/results as untrusted external content. Every call gets a temporary
MCP session; cleanup attempts DELETE and closes local streams. Operations have
the core's 15-second bound. Cancellation does not undo a workflow already
accepted remotely, and connection discovery does not establish every permission.

Private HTTPS instances are intentionally permitted in trusted configuration;
the runtime host owns outbound-network restrictions. It contacts only the exact
configured endpoint and never follows redirects, metadata links or returned
URLs. Changing the URL requires verification again. Tokens and sessions are
not copied into project source; existing encrypted file storage owns grants.

## Automation and application ownership

AI can compose this configuration and runtime wiring once supplied an authorized
token. This fragment provides no API for enabling MCP or issuing its initial
token; provisioning remains manual. OAuth client provisioning is available through `registerN8nClient` below;
instance access policies and actual provider consent still apply.

This token mode has no OAuth app ID. The application owner supplies a credential
for its n8n instance through private Env. Separate credentials give attribution
and revocation; they do not demonstrate independent capacity on the same instance.
Independent capacity requires separate instances or appropriate usage limits.

## Proof and limits

`test/mcp.test.js` uses the real SDK, JSON/SSE response fixtures and encrypted
file storage to exercise discovery, tool calls, input policy, restart, rotation,
changed destinations, isolation, failure handling and cancellation. The editor
test checks the same URL/reference fields and reload. `test/n8nOAuth.test.js`
exercises OAuth with controlled discovery, registration and token responses.
Automatic assistant attachment, stdio, resources/prompts, live n8n and generated
apps are not tested.

## Remaining authorization parity

n8n also supports OAuth. The captured Lovable flow accepts only the server URL
and offers Add & authorize. The runtime supports personal tokens and
OAuth. The editor offers explicit discovery and Register client and connect,
which registers a client, saves configuration and Env, then invokes the
application-owned connection flow. Manual registration remains available. The token path
requires no client registration or callback.

## OAuth discovery helper

`discoverN8nOAuth({ serverUrl }, { fetchImpl, signal })` is exported from the
same server entry point. It returns `{ resource, oauth, scopes }` after reading
the MCP protected-resource and authorization-server metadata through the existing
SDK. It does not register a client, send credentials or open consent.

The exact configured resource must match discovery. A single HTTPS issuer is
required, but it can use a different hostname and installation path. The helper
validates n8n's advertised /mcp-oauth endpoints, S256, refresh and confidential
client_secret_post support. Scopes come from discovery, not a hardcoded universal
list. Failed discovery requires correcting the instance/URL; it does not guess
an OAuth authority from the MCP hostname. Trusted callers own outbound-network
policy, including access to private instances. Requests omit credentials, reject
redirects and share a 15-second cancellation bound.

The editor exposes Discover OAuth settings for n8n. The provider uses saved discovery
as described below. Focused discovery tests
cover split hosts and paths, inconsistent metadata, bad inputs and cancellation.

## OAuth client registration helper

`registerN8nClient({ serverUrl, clientName, callbackUrl, scopes }, options)`
validates setup inputs, performs discovery and submits one confidential-client
registration using the existing MCP registration helper. Select a nonempty
subset of advertised resource scopes. Unsupported scopes fail before POST;
ambiguous failures are not retried. The privileged host owns authorization to
register and private storage of the returned secret.

The result includes clientId, clientSecret, optional clientSecretExpiresAt,
resource, oauth metadata, advertised scopes and the separate requestedScopes.
Advertised scopes are not consent or the permissions to save automatically.
Use the selected requestedScopes for the application's intended configuration.
Never copy the whole result into public JSON: put the secret in Env and retain
only its reference. Registration does not connect an account. The editor can register and store credentials through its explicit action,
or display the endpoint and request body for manual registration.


## Saved OAuth configuration and runtime

For OAuth, save only `{ resource, oauth, scopes }` from discovery/registration as
`integrations.<id>.settings.oauthDiscovery`, alongside `settings.serverUrl`.
Use the same exact resource URL for `serverUrl`. This is public metadata; never
save the complete registration response here. The shared schema validates the
endpoints, protocol capabilities and advertised scope names. OAuth becomes an
available authentication method when discovery settings are present.

Create an ordinary project-owned registration with the returned `clientId`,
`clientSecretRef: "env:N8N_CLIENT_SECRET"` and
`callbackUrlRef: "env:N8N_CALLBACK_URL"`. Put the secret and exact registered
callback in private Env. Choose `authentication.method: "oauth2"`, reference
that registration, and put only the selected `requestedScopes` into the
integration's `scopes`. Advertised permissions are choices, not automatic grants.

Use `n8nProvider` with the existing `createConnectionService`, project-owned
store, reference resolver and authorization policy. `beginAuthorization` uses
the saved authority, selected scopes, S256 and exact resource. Serve the
callback in the application's backend and call `completeAuthorization` there.
The common runtime checks consent, stores encrypted grants and refreshes them
when necessary. It does not rediscover endpoints during token refresh or follow
metadata advertised by a tool response. A changed server URL requires fresh
matching discovery before consent. Revoke provider access in n8n separately
from removing a local connection.

The focused OAuth fixture proves consent, callback exchange, tool discovery,
restart/refresh and rejection of changed resources and malformed saved metadata.
It makes no live provider requests. CLI applications can use this runtime now;
the editor can discover settings and register a client explicitly.
A live n8n deployment and real consent remain untested.


In the editor, enter Server URL and select **Discover OAuth settings**. Choose
**OAuth** in **Authentication**, then open **Permissions** and select the needed
scopes. Open **Set up n8n** for the complete steps. Its **OAuth client
registration** section provides a copyable endpoint and JSON body with the
current callback and selected scopes. Alternatively choose Register client and connect with a new registration and
unused Env keys. This action saves the client and Env, then starts the normal
application-owned connection flow. For manual registration, send the request
once, enter its returned client ID, save and configure Env yourself.

Discovery requires the instance to advertise at least one supported permission.
Versions without that contract can use the personal-token path. Saved metadata
contains public endpoints and permission names only. Selecting a new slot,
changing the URL or editing the draft while discovery runs prevents a stale
response from replacing the new draft. Discovery does not write a file until
Save configuration, and it neither reads nor writes Env.

## Accepted limitations

LIMITATIONS: Automatic Vibe64 coding-chat attachment is deferred. A separately wired CLI or assistant host can discover and invoke exposed workflows through MCP after approving the exact tool and arguments; connecting alone does not attach chat tools. This connector is not the n8n REST API or a workflow designer. Example: an approved host can start an exposed report workflow and receive its result, but saving this connection alone does not let Vibe64 chat start that report. Workflow tools and schemas come from discovery, not a fixed catalogue. Fixture execution is not proof of a live workflow run.
