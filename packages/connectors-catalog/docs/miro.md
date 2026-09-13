# Miro assistant MCP

Checked against Miro's public documentation and discovery metadata on 9 September
2026. This fragment connects an assistant owner's selected Miro team, discovers
tools and calls explicitly authorized tools. Its fixed HTTP endpoint is
`https://mcp.miro.com/`, including the trailing slash.

## Registration and consent steps

1. Read [Connecting to Miro MCP](https://developers.miro.com/docs/connecting-to-miro-mcp).
   A user signs into Miro and selects the team containing the intended boards.
   This MCP client registration is separate from creating a REST API application
   in **Your apps**; those credentials are not interchangeable.
2. Choose the actual callback served by your assistant backend or CLI host.
   Use HTTPS for a remote host; use a loopback callback only where the provider
   accepts that client setup.
3. Invoke `registerMiroClient` once from an authorized setup command. Pass the
   client name, callback and selected scopes. It uses Miro's advertised dynamic
   registration endpoint, requests `client_secret_post`, and returns the client
   ID, secret and any reported secret-expiry timestamp.
4. Store the secret in the host's secret/environment facilities. Write the client
   ID, secret reference and callback reference into the portable registration.
   Never put the secret value in the configuration JSON.
5. In Vibe64, select **Integrations → Add Miro**. Enter **Client ID**, **Client
   secret reference** and **Callback URL reference**. Keep **Assistant access**.
   **Read boards** starts selected; enable other permissions only as needed.
   The **OAuth client registration** panel supplies the endpoint and raw JSON
   POST body for the current callback/scopes. Send it once from your HTTP client
   or use the helper above. Select **Save configuration**, then **Set credential
   in Env** for `MIRO_CLIENT_SECRET` and **Open Env** for `MIRO_CALLBACK_URL`.
   **Connect account** invokes the prepared application runtime; saving alone
   does not register or authorize an account.
6. The host begins authorization and opens the returned URL. Sign in, review the
   requested access, and select the appropriate Miro team. Complete the callback
   under the same authenticated owner. The runtime discovers available tools
   before storing the connection.
7. To switch teams, reconnect and choose the new team during provider consent.
   Discovering tools does not prove access to any particular board. Team and
   organization administrators can restrict access even when a client is valid.

Miro's connection guide documents the **Connect**, sign-in, team-selection and
**Continue** flow. A custom host supplies its own equivalent connect action;
the provider controls its account and team screens.

## Fields and operations

| Field | Meaning |
|---|---|
| Client ID | Assigned by MCP dynamic registration |
| Client secret reference | Reference to the confidential registration's secret |
| Callback URL reference | Reference to the exact backend redirect URI |
| `boards:read` | Board read permission; selected initially |
| `boards:write` | Board writes; initially unselected |
| `openid` | Identity scope; initially unselected |
| `email` | Email scope; initially unselected |

These fields follow the
[authorization metadata](https://mcp.miro.com/.well-known/oauth-authorization-server)
and [resource metadata](https://mcp.miro.com/.well-known/oauth-protected-resource).
The issuer/resource is `https://mcp.miro.com/`; its `/authorize`, `/token` and
`/register` endpoints belong to the same server. The existing OAuth runtime
binds the resource to code and refresh requests. Identity scopes do not turn
this connector into the application's login system.

Import `miroProvider` and `registerMiroClient` from
`@jskit-ai/connectors-catalog/server/miro`, then use the
[assistant OAuth pattern](../patterns/assistant-mcp-oauth/PATTERN.md):

```js
const registration = await registerMiroClient({
  clientName: "My board assistant",
  callbackUrl: configuredCallback,
  scopes: ["boards:read"]
});
```

The host stores the result privately. `tools.list` returns current tool schemas;
`tools.call` requires the host's exact name/argument authorization. For example,
a host can allow the documented `board_search_boards` tool and validate its
query, then authorize board-specific reads separately. Do not infer write
approval from granted OAuth scopes or the presence of a tool in discovery.
Use Miro's current [tool reference](https://developers.miro.com/docs/miro-mcp-tools)
when composing calls; tool availability evolves, and the library does not pin a
second copy of the remote tool catalogue. Returned `isError` stays observable.

## Connection ownership and callbacks

Register the real callback implemented by the runtime that owns this connection.
For an application integration, use the application's assigned hosting URL as
the initial origin and its implemented callback path. Store the exact callback
in its Env reference and provider registration. A domain change requires updating
both values if the callback URL changes; retain the application identity and its
persistent grants when moving hosts. Public Vibe64, Online and CLI users supply
their own registrations through this same contract.
See the [callback guide](../../connectors-core/docs/oauth-callbacks.md).

The application or explicitly authorized assistant host owns the client secret
and grants. Each user still selects a team and grants access. Separate client
IDs do not establish separate team capacity, entitlements or billing limits.

## Automation assessment and proof

Miro documents OAuth with dynamic registration in its
[MCP overview](https://developers.miro.com/docs/miro-mcp). The helper can create
the registration after a privileged caller authorizes setup; AI can assemble
configuration, callback handlers and tool policy. Sign-in, consent, team choice
and any administrator approval remain external actions. The helper never
retries an ambiguous registration automatically.

Focused tests use simulated provider replies and real encrypted files for
registration, PKCE, refresh after restart, replay, ownership, discovery,
tool policy, safe HTTP failures and cancellation. No live registration,
consent, board read/write or sample application was exercised. Managed
assignments, automatic assistant attachment and application login remain
outside this fragment.

**LIMITATIONS (accepted deferral):** Automatic Vibe64 Codex/OpenCode attachment is deferred. Example: a wired CLI/assistant host may discover and authorize a board read or diagram tool, but connecting here does not make the board available in Vibe64 chat. No embedded board editor. Fixture board/diagram names are controlled test inputs, not claims about current remote tool names. Live board access remains unproven.
