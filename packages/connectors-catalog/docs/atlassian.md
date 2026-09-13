# Atlassian assistant MCP

Import `atlassianProvider` and `registerAtlassianClient` from
`@jskit-ai/connectors-catalog/server/atlassian`. This initial fragment connects
the assistant owner's account to Rovo MCP v2. It uses `tools.list` and explicit
`tools.call` through the existing OAuth/file runtime and official MCP SDK.

## Vibe64 setup

Open **Integrations → Add Atlassian**. Choose permissions, set the owning
application's **Suggested callback URL**, and select **Register client and connect**.
The editor registers this project’s client and saves its ID in `integrations.json`
and its secret/callback/recovery ID in development Env. It does not overwrite
existing Env values. The application must implement its callback and integration
setup command before consent can finish. If registration has an uncertain result,
inspect provider registration and project Env before explicitly allowing a retry.
An existing client can be entered using the manual steps below. Production Env
is configured on Deploy; copying configuration alone does not copy secrets.

## Manual setup

1. Choose the assistant host and its exact callback URL. Use HTTPS in a hosted
   environment; an operator's local CLI may use an HTTP loopback callback.
2. Register a confidential client using the helper below or the equivalent
   HTTP request. The reviewed metadata establishes dynamic registration; these
   instructions do not assume a developer-console form for creating an MCP v2
   client. A Jira REST OAuth client or an old MCP v1 client is not interchangeable.
3. In Vibe64, open **Integrations → Add Atlassian → Credentials**. Enter the
   returned **Client ID**. Store the returned secret and callback URL through
   Env; enter their names as **Client secret reference** and **Callback URL
   reference**, for example `env:ATLASSIAN_CLIENT_SECRET` and
   `env:ATLASSIAN_CALLBACK_URL`.
4. Open **Permissions**. Select the products needed by the assistant. Profile,
   account, refresh, Jira read/search and Confluence read/search start selected.
   Writes, deletes, administration and other products start unselected. Save
   configuration. The JSON contains references, never the secret itself.
5. The host calls `beginAuthorization` and opens its returned URL. Sign into
   the intended Atlassian account and review the products/sites and permissions
   presented by Atlassian. Complete consent. The exact provider consent controls
   were not exercised in this implementation; do not substitute automated
   consent for the account owner's decision.
6. Handle the callback under the same authenticated assistant owner using
   `completeAuthorization`. The runtime lists tools before saving a grant.
   A connected status, including an empty tool list, does not establish access
   to every product, site or write operation. Request additional permissions
   through a new authorization attempt when the application needs them.

[Atlassian OAuth configuration](https://support.atlassian.com/atlassian-ai-gateway/docs/configure-oauth-2-1/)
describes consent, product permissions and site restrictions. Existing account
permissions continue to control tool access. If authorization or a tool is
blocked, have the relevant administrator review product/site access and
callback restrictions. This fragment does not change administration policies.

## Provider registration automation

The public [v2 resource metadata](https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp)
identifies the resource `https://mcp.atlassian.com/v2/mcp`, its issuer and 32
supported scopes. The [issuer metadata](https://auth.atlassian.com/.well-known/oauth-authorization-server/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3)
advertises dynamic registration, S256 PKCE and confidential-client authentication.
Both documents were read on 9 September 2026 without registering or signing in.

An authorized setup script can perform registration:

```js
import { registerAtlassianClient } from "@jskit-ai/connectors-catalog/server/atlassian";

const client = await registerAtlassianClient({
  clientName: "My assistant",
  callbackUrl: "https://assistant.example/connections/atlassian/callback",
  scopes: ["read:me", "read:jira:agent-interface", "offline_access"]
});
// Persist client.clientSecret through the host's existing private secret owner.
// Write client.clientId into the portable registration. Never log this result.
```

The helper validates names, callback URLs and unique supported permissions,
uses the official SDK, and returns `clientId`, `clientSecret` and optional
`clientSecretExpiresAt`. The caller owns authorization, secure secret storage
and configuration persistence. Registration runs only when explicitly requested,
never on file save, startup or every Connect action.

For manual registration, use an HTTP client on your own machine:

In Vibe64, expand **Set up Atlassian → OAuth client registration**. Set the
permissions and **Suggested callback URL** first. **Copy registration endpoint**
and **Copy registration request** supply this project's values before a Client
ID exists. Copying sends no request. CLI users can prepare the example below
with their own framework tools.

1. Create a **POST** request to
   `https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3/dcr/register`.
   This is the registration endpoint, not the `/v2/mcp` tool endpoint.
2. Set `Content-Type: application/json` and select a raw JSON body. Replace
   the example name and callback below with the owning application's name and
   exact callback shown in Vibe64. Implement that route in the application
   before attempting user consent.
3. Set the space-delimited `scope` to the permissions selected in Vibe64.
   The example below matches the screen's default profile/account, refresh,
   Jira read/search and Confluence read/search permissions. Remove products
   you do not need from both places.
4. Send once. Copy the successful response's `client_id` into **Client ID**.
   Store `client_secret` as `ATLASSIAN_CLIENT_SECRET` through the project's
   Env editor and enter `env:ATLASSIAN_CLIENT_SECRET` in **Client secret reference**.
   Store the exact callback as `ATLASSIAN_CALLBACK_URL` and enter
   `env:ATLASSIAN_CALLBACK_URL` in **Callback URL reference**.
5. An error response, missing credentials or a different returned redirect URI
   is not a usable registration. Keep the response private; do not paste it
   into source, chat or a shared HTTP-client collection.

```json
{
  "client_name": "My assistant",
  "redirect_uris": ["https://assistant.example/connections/atlassian/callback"],
  "token_endpoint_auth_method": "client_secret_post",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "read:me read:account offline_access read:jira:agent-interface search:jira:agent-interface read:confluence:agent-interface search:confluence:agent-interface"
}
```

The HTTP response uses `client_id` and `client_secret`; the JavaScript helper
returns `clientId` and `clientSecret`. Node applications should reuse the helper
and its response validation. Other frameworks use their own HTTP and private
secret-storage tools; they do not need JSKIT installed.

The helper checks that returned credentials, authentication method and the
single redirect URI match its contract. It does not follow redirects or retry
ambiguous failures. A timeout may leave a client registered; inspect the
provider before creating another one. Metadata proves the advertised protocol,
not that a live registration will be accepted for every client policy. Live
issuance and consent remain untested.

AI can prepare this JSON, call the explicit registration operation after
operator authorization and write the resulting references. It cannot choose a
user's product access, approve consent or establish provider quotas on its own.

## Runtime and portable configuration

```json
{
  "schemaVersion": 1,
  "registrations": {
    "atlassian": {
      "source": "own",
      "clientId": "assigned-v2-client-id",
      "clientSecretRef": "env:ATLASSIAN_CLIENT_SECRET",
      "callbackUrlRef": "env:ATLASSIAN_CALLBACK_URL"
    }
  },
  "integrations": {
    "work": {
      "provider": "atlassian",
      "accountMode": "assistant",
      "scopes": ["read:me", "read:jira:agent-interface", "offline_access"],
      "authentication": { "method": "oauth2", "registrationRef": "atlassian" }
    }
  }
}
```

Compose the [OAuth file pattern](../patterns/oauth-connection/PATTERN.md) with
`providers: [atlassianProvider]`. The shared
[assistant OAuth pattern](../patterns/assistant-mcp-oauth/PATTERN.md) supplies
AI wiring guidance. UI and CLI edit the same validated file. The host uses
encrypted text files for pending attempts and access/refresh grants.

Authorization goes to `auth.atlassian.com/authorize`; token exchange and refresh
go to `auth.atlassian.com/oauth/token`. All three include the v2 resource
identifier. MCP requests go only to `https://mcp.atlassian.com/v2/mcp?tools=all`.
The query requests a flat tool catalogue, as documented in the
[v2 migration guide](https://support.atlassian.com/atlassian-ai-gateway/docs/how-to-upgrade-from-atlassian-rovo-mcp-v1-to-atlassian-rovo-mcp-v2/).
The resource identifier has no query. No token is sent to an arbitrary address
supplied by a tool response or authentication challenge.

`tools.list` accepts an optional cursor. `tools.call` accepts `name` and
`arguments`. The host must authorize that exact name and argument ownership,
including the destination site/project. Tool discovery is not approval to
execute everything it contains. Product permissions remain enforced by
Atlassian; returned `isError` must be handled before reporting success. The
transport grants no sampling/elicitation capability and tries to delete its MCP
session after work. Cancellation cannot undo an accepted tool mutation.
Disconnect deletes the local grant; it does not revoke all provider access.

## Connection ownership and callbacks

This fragment is for an explicitly configured assistant host. That host owns its
client registration, callback, private credentials and grants; it may be an
application-owned assistant or an opt-in editor tool. Merely adding the provider
to a project does not authorize the editor's coding assistant. It does not supply
published app-user login. The host's callback may differ from the published app's
domain, but it must match that host's real route and registered redirect URI.

Use the owning host's actual callback as the registration helper's `callbackUrl`.
Persist the resulting credentials in its private Env. Update the registration
and callback Env if this route changes when moving hosts; retain the runtime's
identity and stored grants. Separate clients do not establish separate capacity:
[Atlassian's overview](https://support.atlassian.com/atlassian-ai-gateway/docs/get-started-with-the-atlassian-remote-mcp-server/)
describes organization-level Rovo credit usage.

This fragment does not implement native public-client authentication, app-user
login, API tokens, REST adapters or automatic assistant attachment. V1 uses a
different OAuth resource; existing v1 clients/grants must not be silently reused
for v2.

## Focused proof

Eight simulated-provider tests exercise registration, PKCE/resource binding,
refresh after file restart, encrypted state, owner/site isolation, changed
consent scopes, reduced grants, empty/malformed discovery, provider failures,
interruption and session cleanup. Editor proof checks product permission
choices, reference validation and file reload. No live client registration,
consent, provider tool use or generated application is included.

## LIMITATIONS

Vibe64's coding assistants do not yet receive these tools automatically. For
example, connecting Jira here does not let the editor's Codex/OpenCode chat
retrieve DOG-42. An application-owned assistant can call the runtime's tools
with its own authorization policy; this bridge to editor chat is deferred.

The runtime preserves Jira issue and Confluence page content supplied by tools,
but the application owns how it presents, summarizes or acts on that content.
OAuth consent and organization policies still control actual product access.
No live registration, real Jira/Confluence access or generated-app run was tested.
