# Amplitude assistant MCP

Import `amplitudeProvider` and the explicit setup helper
`registerAmplitudeClient` from `@jskit-ai/connectors-catalog/server/amplitude`.
This is an assistant-owner OAuth connection. It exposes MCP tool discovery and
authorized calls for analytics/content work, not event ingestion or app login.
Amplitude's [client guide](https://amplitude.com/docs/amplitude-ai/amplitude-mcp/other-clients)
requires remote HTTP MCP with OAuth; an API key cannot replace this flow.

## Manual setup and account controls

1. Sign into the intended Amplitude account and identify its US or EU residency.
   Use that same region in the editor and client registration.
2. If MCP access is blocked, an organization administrator opens **Settings →
   Content Access → MCP** and reviews the organization-level setting.
3. For project-specific access, the administrator opens **Org Settings → Role
   Management**, creates/edits the role, and selects **AI Features → Use MCP
   (read)** and, when needed, **Use MCP (write)**. Assign the role to the intended
   user/group/service account and projects.
4. In Vibe64, leave the new Client ID empty, set the Suggested callback URL and
   choose **Register client and connect**. The workspace owner can register once
   at the selected regional authority; Vibe64 saves the client ID in configuration
   and its secret, callback and recovery client ID in development Env before
   starting the application’s connection command. Existing Env values are not
   overwritten. If local saving fails, recover the client from Env/provider state
   before trying again. CLI users can use the setup operation below. The reviewed
   documentation establishes dynamic registration, not a manual developer-app
   creation screen; do not search for an invented console form.
5. Enter the returned **Client ID** in Vibe64. Store its secret and the exact
   callback URL through Env, then fill **Client secret reference** and
   **Callback URL reference**. Keep secrets outside `integrations.json`.
6. Save. Through the runtime's authorization flow, open the returned URL, sign
   into Amplitude, review requested permissions and complete consent. The
   callback must recover the same authenticated assistant owner.

[Amplitude organization and role controls](https://amplitude.com/docs/amplitude-ai/amplitude-mcp#admin-controls).
Tool discovery remains visible even where project-level calls are forbidden;
discovery is not proof of access to every project or write operation.

## Registration automation

The US server's public
[authorization metadata](https://mcp.amplitude.com/.well-known/oauth-authorization-server)
advertises `/register`, code grants, refresh tokens, S256 PKCE, and
`client_secret_post`/`none` authentication. Its
[resource metadata](https://mcp.amplitude.com/.well-known/oauth-protected-resource)
identifies `https://mcp.amplitude.com` as the OAuth resource. Equivalent EU
metadata is served at `https://mcp.eu.amplitude.com`. These public metadata
documents were read on 9 September 2026; no client or user account was created.

After the operator authorizes registration, a setup script can call:

```js
import { registerAmplitudeClient } from "@jskit-ai/connectors-catalog/server/amplitude";

const client = await registerAmplitudeClient({
  region: "us",
  clientName: "My assistant",
  callbackUrl: "https://assistant.example/connections/amplitude/callback",
  scopes: ["mcp:read", "offline_access"]
});
// Securely store client.clientSecret in the host's existing secret owner.
// Put client.clientId in the portable registration; never log this object.
```

The helper uses the official MCP SDK to POST confidential-client metadata to
the fixed regional registration endpoint. It requests one exact redirect URI,
code/refresh grants and `client_secret_post`, and validates the returned client
and redirect metadata. It returns `clientId`, `clientSecret` and any
`clientSecretExpiresAt` value. This is a privileged setup result, never an
ordinary connection-status response. The host must authorize invoking it and
store its secret before exposing the nonsecret configuration.

HTTPS callbacks and HTTP loopback callbacks are supported; credentials, query
strings and fragments are rejected. The helper does not follow redirects,
automatically retry, create an Amplitude account or complete consent. If
registration times out, inspect the provider before retrying: a client might
already exist. Registration metadata does not prove live issuance will succeed
for every account or client policy; that acceptance check remains unperformed.

For manual registration, use an HTTP client on your own machine:

In Vibe64, expand **Set up Amplitude → OAuth client registration**. Set the
region, permissions and **Suggested callback URL** first. **Copy registration
endpoint** and **Copy registration request** provide the values for this
project without requiring a Client ID. Copying sends no request. The example
below is for CLI users or an HTTP client configured by hand.

1. Create a **POST** request to `https://mcp.amplitude.com/register` for US,
   or `https://mcp.eu.amplitude.com/register` for EU. Do not send it to the
   `/mcp`, `/authorize` or `/token` endpoint.
2. Set the request header `Content-Type: application/json`. Set the body to
   raw JSON using the example below. Replace the example name and callback
   with the owning application's name and exact callback shown in Vibe64.
   The application must implement that route before user consent can finish.
3. Match `scope` to the permissions selected in Vibe64. The example uses the
   default read and refresh permissions; add `mcp:write` only when needed.
4. Send once. On a successful response, copy `client_id` into **Client ID**.
   Store `client_secret` as `AMPLITUDE_CLIENT_SECRET` through the project's
   Env editor; enter `env:AMPLITUDE_CLIENT_SECRET` in **Client secret reference**.
   Store the exact registered callback as `AMPLITUDE_CALLBACK_URL`; enter
   `env:AMPLITUDE_CALLBACK_URL` in **Callback URL reference**.
5. Do not save an error response, missing credentials or a different returned
   redirect URI as a valid registration. Treat the response as secret material;
   do not paste it into source, chat or a shared HTTP-client collection.

```json
{
  "client_name": "My assistant",
  "redirect_uris": ["https://assistant.example/connections/amplitude/callback"],
  "token_endpoint_auth_method": "client_secret_post",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "mcp:read offline_access"
}
```

The HTTP response uses `client_id` and `client_secret`; the JavaScript helper
returns `clientId` and `clientSecret`. The helper also validates the response,
so Node applications should reuse it. Other frameworks implement this same
provider protocol using their own HTTP and secret-storage tools.

## Portable configuration and runtime

```json
{
  "schemaVersion": 1,
  "registrations": {
    "amplitude": {
      "source": "own",
      "clientId": "assigned-client-id",
      "clientSecretRef": "env:AMPLITUDE_CLIENT_SECRET",
      "callbackUrlRef": "env:AMPLITUDE_CALLBACK_URL"
    }
  },
  "integrations": {
    "analytics": {
      "provider": "amplitude",
      "accountMode": "assistant",
      "scopes": ["mcp:read", "offline_access"],
      "authentication": { "method": "oauth2", "registrationRef": "amplitude" },
      "settings": { "region": "us" }
    }
  }
}
```

The UI and CLI use the same parser and JSON. Region defaults to US. Read access
and refresh access default on; content writes default off. `tools.list` and
`tools.call` require a granted read permission. Amplitude additionally enforces
write/project permissions at call time. The host's authorization callback must
validate each requested tool name and its argument ownership before execution.

Use the ordinary [OAuth file pattern](../patterns/oauth-connection/PATTERN.md)
with `providers: [amplitudeProvider]`, and the
[assistant OAuth pattern](../patterns/assistant-mcp-oauth/PATTERN.md) for tool policy.
`beginAuthorization` creates a state/PKCE attempt. `completeAuthorization`
exchanges the code, initializes MCP and lists tools before persisting the grant.
Consent, code exchange and refresh all target the selected regional origin;
authorization and both token grants include its OAuth resource identifier.
Changing region invalidates pending/connected grants. Runtime state remains
encrypted text files using the existing file-store owner.

`tools.list` takes an optional opaque cursor. `tools.call` takes a tool `name`
and `arguments` object. The provider uses the standard `/mcp` endpoint and the
existing MCP transport; it does not automatically execute tools, attach them
to an assistant, follow returned URLs or grant sampling/elicitation capabilities.
Tool-level `isError` results remain data for the host to handle. Cancellation
stops local work and attempts session cleanup; it cannot undo accepted writes.
Disconnect removes local state without revoking all provider access.

## Connection ownership and callbacks

This fragment is for an explicitly configured assistant host. That host owns its
client registration, callback, private credentials and grants; it may be an
application-owned assistant or an opt-in editor tool. Merely adding the provider
to a project does not authorize the editor's coding assistant. It does not supply
published app-user login. The host's callback may differ from the published app's
domain, but it must match that host's real route and registered redirect URI.

AI can automate client registration and prepare configuration after authorized
setup inputs are supplied. Register the host's actual callback with the selected
US or EU endpoint, then retain the returned credentials in that host's private
Env. User sign-in/consent and organization permission changes remain owner/admin
actions. Separate client IDs do not prove independent Amplitude quotas for users
of the same organization. If the callback changes, update the client registration
and callback Env; a new hostname does not change the connection owner.

This adapter does not implement native public-client authentication, the
production event API, progressive-discovery UI, Amplitude service-account setup
or app-user OAuth.

## Focused proof

Eight tests cover US/EU registration metadata and code/refresh resource binding,
PKCE, file restart, credential encryption, region changes, owner isolation,
exact tool policy, declined/insufficient consent, malformed discovery, provider
failures, cancellation and no automatic registration replay. Editor proof
covers region, permission choices, secret references and persistence. Provider
signup, live registration/consent, live tool calls and generated apps are excluded.


## LIMITATIONS

Editor coding-assistant tool attachment is deferred. For example, this runtime
can call an authorized Amplitude analytics tool from an explicitly composed
application-owned assistant, but configuring it in Vibe64 does not let Codex or
OpenCode answer “where are customers dropping out of my funnel?” from your live
Amplitude data. Registration and consent do not attach tools to editor chat.
No live Amplitude registration, consent or generated application was exercised.
