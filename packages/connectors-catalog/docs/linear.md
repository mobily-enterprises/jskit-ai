# Linear

Import `linearProvider` from `@jskit-ai/connectors-catalog/server/linear`.
This adapter supports a personal API key or project-owned OAuth, with GraphQL reads and Linear MCP tools. Vibe64 edits the project configuration; the generated application owns its runtime and credentials.

## Configure access

1. Select the intended Linear workspace and open **Settings → Account → Security & Access**.
2. In the personal API-key section, create a key with a descriptive application
   name. Choose read access and the teams the application needs where these
   controls are offered.
3. Enter `env:LINEAR_API_KEY` in API key reference, **Save configuration**, then choose **Set credential in Env** and store the key as `LINEAR_API_KEY`. Return to connect.
4. Save provider `linear`, mode `shared` or `assistant`, `scopes: ["read"]`, and
   authentication `{ "method": "api-key", "secretRef": "env:LINEAR_API_KEY" }`.
5. Call `connectApiKey` to verify the viewer; manage/revoke the key in the same
   settings section. [Authentication guide](https://linear.app/developers/graphql).

## Runtime and CLI composition

The API is `POST https://api.linear.app/graphql`. Personal keys use the raw
`Authorization` header, without the OAuth Bearer prefix. `profile.read` selects
`viewer { id name email }`. `issues.list` accepts `first` (1–100, default 50;
100 is this fragment's cap) and optional `after`; it returns issue IDs,
identifiers, titles and `pageInfo`. Continue using `endCursor` only while
`hasNextPage` is true. [Pagination](https://linear.app/developers/pagination).

Both queries are fixed in the provider module. Input values become GraphQL
variables, never interpolated query text. Responses with GraphQL errors are
rejected even when HTTP status is 200 and partial data exists. The application
must not display that partial data as a successful result.

Use the [API-key pattern](../patterns/api-key-connection/PATTERN.md). It leaves
application authorization with the caller and persists connection state in files.

## Automation and application registrations

Personal key creation uses the interactive settings flow. For OAuth applications,
Linear supports a JSON application manifest: an AI can fill display information,
callback URLs and other supported configuration, then prepopulate the app-creation
page. A person still reviews and creates the application's own registration.
No unverified unattended registration API is assumed. [Application manifests](https://linear.app/developers/oauth-app-manifests).

Distinct
names/keys alone do not establish independent organization/user rate limits.
The application owner supplies the key and controls access to its organization.
Tests cover fixed queries, variables, pagination, partial errors, persistent
state, credential changes and isolation without live issue access.

## Project-owned OAuth

1. As a workspace administrator, open **Settings → Administration → API** and
   create an OAuth application. The direct creation page is
   <https://linear.app/settings/api/applications/new>. Register the exact
   **Suggested callback URL** from this project's integration screen.
2. Copy its Client ID into the form. Save configuration and use the Env links to
   store `LINEAR_CLIENT_SECRET` and `LINEAR_CALLBACK_URL`. Registering the URL
   does not implement the application's callback handler.
3. Keep `read` selected; choose additional permissions only for required features.
   This adapter uses `actor=user`, including in assistant mode. Service-account
   actors and client-credentials grants are outside this adapter's flow.
4. Shared/assistant connections start with **Connect account**. Per-user
   connections start in the generated application's authenticated account screen.
   The framework owns login and callback routing; JSKIT supplies the JavaScript
   lifecycle library. Other frameworks use their own OAuth implementation.
5. Approve the intended workspace. Verification reads the viewer. Cancel a pending
   attempt locally if you abandon consent; reconnect starts a new attempt.
6. Disconnect clears the local grant. For remote revocation, open **Settings →
   Account → Security & Access → Authorized applications**, hover the application
   and choose **Revoke access**. Another workspace uses another connection.

Authorization uses comma-separated scopes, S256 PKCE and a project-owned secret
posted to Linear's token endpoint. Returned space-separated permissions (or
Linear's documented array form) are normalized before the shared lifecycle stores
and enforces them. Refresh tokens rotate and remain in the application's encrypted
connection store. Client secrets and grants are never stored in source.
[OAuth protocol](https://linear.app/developers/oauth-2-0-authentication),
[account access controls](https://linear.app/docs/security-and-access).

Use the [OAuth pattern](../patterns/oauth-connection/PATTERN.md), with registration
`source: "own"`, `tokenEndpointAuthMethod: "client_secret_post"`, the Client ID and
Env references above. Use provider `linear`, a registration reference in
`authentication`, and `scopes: ["read"]`. `beginAuthorization`,
`completeAuthorization`, `invoke`, and `disconnect` retain the same ownership
contract as other OAuth connectors.

## MCP with the same connection

`tools.list` and `tools.call` use the fixed Streamable HTTP endpoint
`https://mcp.linear.app/mcp`. Linear explicitly supports reusing an API key or an
existing Linear OAuth grant for this endpoint, so this path needs no additional
MCP registration. The adapter supplies raw key authorization to GraphQL and Bearer
authorization to MCP; OAuth uses Bearer for both. The captured Lovable interactive
MCP registration flow is a different registration path, not required for this
project-owned connection. The deprecated `/sse` endpoint is not used.

Tool calls may write when the provider grant allows it. The application must
approve/authorize the named operation and its arguments; `read` alone cannot
permit writes at Linear. Discovery does not execute tools. Use `tools.list` to
obtain available schemas rather than maintaining a second catalogue here.
[Linear MCP authentication](https://linear.app/docs/mcp).

## Review evidence

The focused fixture tests cover OAuth authorization, cancellation/denial, replay,
refresh rotation after restart, app/user isolation, lost scopes, raw API-key
GraphQL authorization and Bearer MCP discovery. No real Linear account, issue,
consent or tool execution was used. Both credential modes passed a controlled public-editor browser review: configuration survives reload, Env links and provider guides resolve to the intended destinations, and simulated connection controls work. The 496px instruction captures were visually inspected; no live provider consent or fresh phone review is claimed.

## Approved project and issue workflows

The existing MCP transport can discover and invoke the provider's project/issue
tools with either connection method. Discover `tools.list` (including returned
cursors), inspect each current input schema, then authorize the tool name and
arguments against the requesting app user and selected team/project. Supply write
permissions only when needed. Do not copy fixture tool names into application code.

```js
const result = await connections.invoke({
  context: authorizedContext, integrationId: "linear", operation: "tools.call",
  input: { name: approvedTool.name, arguments: approvedTool.arguments }
});
if (result.isError) throw new Error("Linear did not complete the requested action.");
```

`connections`, authenticated context and `approvedTool` are app-owned composition,
not exported globals. Use the returned project identifier when creating its issue;
use the returned issue identifier when updating it. The authorization callback
must enforce the exact target and write approval before transport. Never blindly
retry an uncertain create. CLI apps use the same library/configuration/Env; other
frameworks compose their native MCP client and authorization with those values.

**LIMITATIONS:** No maintained tool catalogue, project-management UI or automatic
Vibe64 Codex/OpenCode attachment. Example: an app can explicitly run an approved
issue update, but saving a Linear connection alone does not teach Vibe64's coding
chat to update that issue. Provider permissions and available tools determine what
can run. Fixture workflows prove argument/result transport and local denial, not
actual Linear tool schemas or live execution.
