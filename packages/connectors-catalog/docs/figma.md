# Figma remote MCP

Checked against Figma's public documentation and OAuth discovery on 9 September
2026. This fragment connects an assistant owner's account, discovers tools and
invokes an explicitly authorized tool. It uses the remote HTTP server, not the
desktop MCP server or a personal access token for Figma's REST API.

## Prerequisites and registration

Figma currently admits clients listed in its MCP catalogue. A new client must
request approval through the waitlist linked from the
[MCP introduction](https://developers.figma.com/docs/figma-mcp-server/).
The registration endpoint's existence does not remove that requirement.

1. Open that introduction and follow **join the waitlist** in the client-access
   notice. Supply the intended assistant client and usage details requested by
   Figma. Wait for acceptance; this package cannot approve a client.
2. Choose the callback implemented by your backend or CLI host. For your own
   application, this is its actual HTTPS callback, or a loopback callback where
   accepted. The host must retain the pending owner and state through consent.
3. After approval, use Vibe64's **OAuth client registration** section to copy
   the endpoint and JSON body into an HTTP client and send one POST with
   Content-Type application/json. Alternatively invoke `registerFigmaClient`
   once from a trusted setup command.
   It sends `client_name`, the exact callback, the authorization-code/refresh
   grant types and `mcp:connect` to Figma's advertised registration endpoint.
   It requests confidential client authentication using `client_secret_post`.
4. Put the returned client ID in `registrations.figma.clientId`. Store the
   returned secret and callback in your host's existing secret/environment
   facilities; place only references in `clientSecretRef` and `callbackUrlRef`.
5. In Vibe64, open **Integrations → Add Figma**. Enter **Client ID**,
   **Client secret reference** and **Callback URL reference**. Keep **Assistant
   access** and **Use Figma MCP tools**, then save. Use **Set credential in Env** for the returned secret and **Set
   callback in Env** for the exact registered URL. Saving edits the same JSON
   a CLI user writes; it does not register the client or start consent.
6. Your host calls `beginAuthorization` and opens its URL. Sign into Figma and
   review the consent screen. Its callback calls `completeAuthorization` for
   the original authenticated owner. The runtime verifies tool discovery before
   saving a connected grant.

There is no separate REST-app dashboard step in this MCP registration fragment.
Figma's [remote-server instructions](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)
show the consent UI for supported clients. Do not copy another client's ID to
bypass the approval process.

## Runtime and CLI composition

Import `figmaProvider` and `registerFigmaClient` from
`@jskit-ai/connectors-catalog/server/figma`. Use the
[assistant OAuth pattern](../patterns/assistant-mcp-oauth/PATTERN.md) with the
existing connection service, environment resolver and encrypted file store.

```js
const registration = await registerFigmaClient({
  clientName: "My design assistant",
  callbackUrl: configuredCallback
});
```

The setup caller authorizes this operation and stores `registration.clientSecret`
securely. Do not print the result or run registration for each sign-in. On an
ambiguous failure, check with the provider before trying to create another client.

The provider's resource is `https://mcp.figma.com/mcp`. Authorization uses
`https://www.figma.com/oauth/mcp`; exchange/refresh use
`https://api.figma.com/v1/oauth/token`. Discovery advertises an authorization
response issuer, which the runtime requires and validates. PKCE, state,
single-use attempts, refresh, isolation and token storage belong to the shared
connection implementation.
[Authorization metadata](https://api.figma.com/.well-known/oauth-authorization-server),
[resource metadata](https://mcp.figma.com/.well-known/oauth-protected-resource).

Call `tools.list` first; use the returned schemas to validate inputs for
`tools.call`. The host must approve the exact name and arguments, including file
and node identity. `mcp:connect` is a broad MCP permission, not a read-only
guarantee. A host that only needs design reads should disallow write tools in its
own policy. Preserve the tool's `isError` result and surface provider failures.
Discovery does not prove access to a particular design.

## Connection ownership and callbacks

Register the real callback implemented by the runtime that owns this connection.
For an application integration, use the application's assigned hosting URL as
the initial origin and its implemented callback path. Store the exact callback
in its Env reference and provider registration. A domain change requires updating
both values if the callback URL changes; retain the application identity and its
persistent grants when moving hosts. Public Vibe64, Online and CLI users supply
their own registrations through this same contract.
See the [callback guide](../../connectors-core/docs/oauth-callbacks.md).

The registration and grants belong to the application or explicitly authorized
assistant host consuming Figma. Provider approval and usage quotas still apply;
separate client IDs do not establish separate capacity or broader permissions.

## Automation assessment and limits

The helper can automate the documented client-registration request and field
validation after eligibility is established. AI can prepare configuration,
callback handling and permitted tool policy. Provider approval, account sign-in
and user consent require the appropriate human/provider action. No account,
registration, consent or tool call was performed against Figma in these tests.

Tests use controlled OAuth/MCP responses with real encrypted file persistence.
They exercise issuer binding, refresh, owner isolation, replay, invalid inputs,
tool authorization, cancellation, safe failures and registration behavior.
Local desktop MCP, automatic chat attachment, login and resources/prompts
are not implemented by this fragment.

## Design context and topology

After connection, discover the current tool schemas and explicitly authorize the
selected file and node before calling `get_design_context`. A Figma frame link
identifies that selection. Preserve returned text, images and tool errors for
the authorized assistant host. The returned context is provider-owned, not a
fixed JSKIT design schema; fixtures demonstrate consumption rather than asserting
an immutable live tool signature. The host chooses the target framework and
performs code generation itself.

**LIMITATIONS:** This supplies remote MCP only. Installed Vibe64 and Online can
both use the remote server with their own approved registration. Desktop MCP is
local to the machine running Figma Desktop and the consuming client: on Online,
127.0.0.1 means the VPS, not the user's laptop. Native desktop clients may configure
Figma Desktop independently; no tunnel/proxy is provided here. Government-only
desktop deployments are outside this remote connector.

Editor coding-assistant attachment is deferred. For example, an explicitly wired
assistant host can receive an authorized booking-card layout and screenshot, but
saving Figma in Vibe64 does not yet let Codex/OpenCode reproduce that frame.
App-user login, Make resources/prompts and a visual Figma editor are not supplied.
Other frameworks use a native MCP/OAuth client and the same config/Env contract;
PHP/other runtime code does not belong in JSKIT. Provider approval remains external;
new-client registration is a guided setup/helper request, not automatic admission.
