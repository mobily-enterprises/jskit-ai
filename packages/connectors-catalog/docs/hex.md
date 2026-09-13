# Hex assistant connection

Import `hexProvider` and `registerHexClient` from
`@jskit-ai/connectors-catalog/server/hex`. This initial library connects an
assistant owner to remote MCP and exposes `tools.list` and `tools.call`.
It reuses the OAuth state, refresh and encrypted file-store implementations.

## Provider setup

1. Check the intended Hex workspace endpoint and account. Hex documents MCP on
   Team and Enterprise plans with an Explorer or higher role.
2. Choose Standard, Europe or HIPAA in the Vibe64 **Hex workspace endpoint**
   field. Single-tenant custom Hex domains are not supported by this fragment.
3. Confirm **Suggested callback URL** is the route your host will serve. Choose
   **Register client and connect** to register at the selected fixed authority.
   The public editor saves the ID in project configuration and the secret, callback
   and recovery ID in development Env, then starts the app-owned setup command.
   Existing Env values are not replaced. Alternatively in
   **OAuth client registration**, copy the endpoint and JSON request body into
   your HTTP client and send one POST with Content-Type application/json.
   This endpoint changes with the selected Hex region. Register once; the
   provider guide does not establish a developer-console creation screen.
4. For manual registration, copy `client_id` into **Client ID** and **Save configuration**. Choose
   **Set credential in Env** to save `client_secret` under the displayed reference.
   Choose **Set callback in Env** to save the same callback used for registration.
   Return to the form after saving Env. Keep the full registration response private.
5. Select identity/profile/email/refresh permissions and save configuration.
   Saving does not register a client or connect the account. The host must open
   `beginAuthorization`'s URL and complete the callback under the same owner.
6. In the provider browser flow, sign in, choose the workspace when prompted
   and approve consent. Verification discovers tools without starting a Thread.

Hex documents project search, Thread creation/retrieval/continuation and project editing tools. Editing requires Editor or higher and the specific project permission.
Its workspace API-access switch does not revoke MCP access. Sensitive data
connection controls live under **Settings → Integrations → Configure sensitive
data connections for external integrations**, or the data source's **Access**
tab. These settings remain under the workspace administrator's control.
[Hex MCP guide](https://learn.hex.tech/docs/api-integrations/mcp-server).

## Explicit registration and automation

Public metadata was rechecked on 12 September 2026 for all three endpoints. The
resource is `https://<host>/mcp`; its issuer is `https://auth.<host>`. The issuer
advertises `/oauth2/authorize`, `/oauth2/token` and `/oauth2/register`, S256,
code/refresh grants and `client_secret_post` authentication among its options.
Its scopes are `openid`, `profile`, `email` and `offline_access`.
[Standard resource metadata](https://app.hex.tech/.well-known/oauth-protected-resource/mcp),
[standard OAuth metadata](https://auth.app.hex.tech/.well-known/oauth-authorization-server),
[EU metadata](https://auth.eu.hex.tech/.well-known/oauth-authorization-server),
[HIPAA metadata](https://auth.hc.hex.tech/.well-known/oauth-authorization-server).

After the setup caller has authorization to create a provider client:

```js
const registration = await registerHexClient({
  endpoint: "standard",
  clientName: "My assistant",
  callbackUrl: "https://assistant.example/connections/hex/callback",
  scopes: ["openid", "profile", "email", "offline_access"]
});
// Persist registration.clientSecret through the existing secret owner.
// Save registration.clientId in configuration; never log the whole result.
```

The helper uses the MCP SDK with one exact callback, code/refresh grants and
`client_secret_post`. It validates returned client and redirect metadata and
returns `clientId`, `clientSecret` and any `clientSecretExpiresAt`. HTTPS and
HTTP loopback callbacks are accepted; credentials, query and fragment are not.
The host owns authorization to invoke this helper and storing its result.

An AI with an authorized setup API can prepare configuration and call this
helper. It cannot complete human consent, change provider entitlements or
promise registration acceptance from metadata alone. No live registration was
performed. Failed or interrupted registration must not be automatically retried;
the provider might already have created a client. The equivalent manual HTTP
operation is a JSON POST to the selected issuer's `/oauth2/register` with the
helper's `client_name`, `redirect_uris`, `token_endpoint_auth_method`,
`grant_types`, `response_types` and space-delimited `scope` fields.

## Portable configuration and runtime

```json
{
  "schemaVersion": 1,
  "registrations": {
    "hex": {
      "source": "own",
      "clientId": "assigned-client-id",
      "clientSecretRef": "env:HEX_CLIENT_SECRET",
      "callbackUrlRef": "env:HEX_CALLBACK_URL"
    }
  },
  "integrations": {
    "analysis": {
      "provider": "hex",
      "accountMode": "assistant",
      "scopes": ["openid", "profile", "email", "offline_access"],
      "authentication": { "method": "oauth2", "registrationRef": "hex" },
      "settings": { "endpoint": "standard" }
    }
  }
}
```

CLI and UI validate the same configuration. `endpoint` defaults to `standard`;
`eu` and `hipaa` select their respective fixed MCP/issuer pair. No arbitrary
provider URL is accepted. Changing endpoint invalidates a pending attempt and
requires reconnecting an existing grant. Configuration stores references;
runtime grants and attempts use the host-selected file store.

Compose the existing `oauth-connection` and `assistant-mcp-oauth` patterns with
this provider. Both operations require granted `openid`. All four permissions
are selected initially; profile/email/refresh can be omitted. Identity scopes
are not a read-only tool boundary. The host must authorize the exact tool name,
arguments, workspace and intended effect. Obtain argument schemas from
`tools.list`, which accepts an explicit cursor; do not guess Thread fields.
`tools.call` preserves the result and `isError` flag. Listing tools does not
grant permission to run an analysis or consume credits.

The library does not automatically poll a Thread, fetch all discovery pages,
retry a call or attach tools to an AI. The host schedules any explicit follow-up
read and displays its status. Disconnect removes the local grant, not provider
work already accepted. OAuth here does not implement login to an application.

## Connection ownership and callbacks

This fragment is for an explicitly configured assistant host. That host owns its
client registration, callback, private credentials and grants; it may be an
application-owned assistant or an opt-in editor tool. Merely adding the provider
to a project does not authorize the editor's coding assistant. It does not supply
published app-user login. The host's callback may differ from the published app's
domain, but it must match that host's real route and registered redirect URI.

Register this host's actual callback for the selected Standard, Europe or HIPAA
endpoint. Its selected endpoint and credentials belong to this connection; keep
runtime records bound to that owner. Update registration and callback Env when
the actual callback changes. Separate clients do not establish separate Hex
workspace credits or capacity. Provider accounts, plans and workspace permissions
still apply. Selecting the HIPAA endpoint is a routing choice, not a compliance
certification for JSKIT, Vibe64 or a generated application. The explicit registration and controlled connection UI have been reviewed.
The explicit Register client and connect action supports DCR; ordinary Connect
does not silently create another registration.

## Focused verification and limits

The controlled tests exercise selected endpoints, PKCE/resource binding,
registration request/response validation, file restart and encryption, refresh,
owner and tool policy, consent/permission failures, pagination, redacted errors
and interruption without replay. Browser proof covers endpoint/permission and
reference persistence. Live registrations, consent, actual Hex tool calls,
single-tenant hosts, provider billing and real generated applications are not
part of that proof. The separate Hex REST API/token mode is not implemented.

**LIMITATIONS:** Editor coding-assistant attachment and notebook/Thread widgets
are deferred. For example an app-owned MCP host can call Hex project or Thread
tools after its own permission checks, but adding this form does not let Vibe64
Codex/OpenCode analyze the workspace. The app owns tool discovery/schema use,
status polling, output rendering, sensitive data policy and credit approval.
Single-tenant custom hosts, REST/token mode and live Hex execution remain outside
this adapter. Other frameworks use their native MCP client and the same project
configuration/Env; they do not need JSKIT or a Node sidecar.
