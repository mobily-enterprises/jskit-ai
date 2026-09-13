# Notion

Import `notionProvider` from `@jskit-ai/connectors-catalog/server/notion`.
This adapter accepts an internal connection token using `api-key`, or a
project-owned public connection using `oauth2`. It pins
`Notion-Version: 2026-03-11`. Hosted Notion MCP uses a separate connection mode and client registration.
Its controlled editor journey is verified; live consent remains untested.

## Set up access

1. Open [Notion's Developer portal](https://www.notion.so/profile/integrations)
   with permission to create a connection in the intended workspace.
2. In **Build → Internal connections**, choose **Create a new connection**, enter
   a name, and select the installation workspace.
3. In **Configuration**, enable **Read content** and copy the **Installation
   access token**. Store the connection token outside application source
   as `NOTION_API_KEY`.
4. Use **Content access → Edit access**, or on a page open **••• → Connections →
   + Add connection**. Select the connection and intended content. Parent access
   includes children. An internal connection is workspace-specific.
5. In `integrations.json`, select provider `notion`, mode `shared` or `assistant`,
   empty `scopes`, and authentication method `api-key` with secret reference
   `env:NOTION_API_KEY`. No client registration or callback is needed for this mode.
6. Verify using `connectApiKey`; it performs a title search. Follow the
   [internal connection guide](https://developers.notion.com/guides/get-started/internal-connections)
   and [content authorization instructions](https://developers.notion.com/guides/get-started/authorization).

## Runtime and AI composition

`content.search` accepts `query`, `page_size` (1–100), and `start_cursor` and
returns the provider's list envelope, including `has_more` and `next_cursor`.
This is title search over accessible pages/data sources, not arbitrary full-text
search. `identity.read` returns the token's user; the response may describe a
bot or a person. See [Search](https://developers.notion.com/reference/post-search)
and [Token identity](https://developers.notion.com/reference/get-self).

Apply the [API-key source pattern](../patterns/api-key-connection/PATTERN.md)
with this provider. The application owns which callers may search the shared
workspace. It supplies the same JSON file whether configured by a CLI or UI.
Page content, product screens and any writes remain separate application work.

## Provisioning automation and capacity

An AI can prepare the library wiring and configuration; these ordinary internal
connection instructions still require a workspace operator to create the token
and share content. This pass has not verified an administrative API that creates
equivalent connections across arbitrary workspaces. Do not infer that from
Notion's content API or use undocumented console endpoints.

Each application supplies its intended Notion connection. Check provider limits
for that connection/workspace; different names do not prove isolated capacity
or permit one workspace's data to be shared with another. Unrelated app users require the separate public OAuth mode.

Fixtures cover version headers, JSON search bodies, cursors, file restart,
credential rotation, owner isolation, and rejected or malformed responses.
No Notion workspace was connected during testing.

## Public OAuth connection

Use [Notion's public connection guide](https://developers.notion.com/guides/get-started/public-connections)
and the inline OAuth setup instructions. In the Developer portal choose
Build → Public connections, create the connection with its installation scope,
Read content capability and exact application callback, then retrieve the client
ID and secret from Configuration. Store the secret and callback in Env.

The JSON registration uses source `own`, `tokenEndpointAuthMethod`
`client_secret_basic`, `clientId`, `clientSecretRef` and `callbackUrlRef`.
The integration uses method `oauth2`, `registrationRef`, empty `scopes` and the
intended shared/per-user account mode. The app owns its callback route and uses
`beginAuthorization`, `completeAuthorization`, `invoke` and `disconnect` from
the common connection service with its authorized owner and configured storage.
Laravel implements the same provider protocol in its own framework; JSKIT
contains no PHP runtime. Vibe64 edits this configuration and the project's Env.

The adapter sends owner=user and the exact callback at authorization. It uses
confidential Basic authentication and JSON requests at the token endpoint, per
[Notion's authorization guide](https://developers.notion.com/guides/get-started/authorization).
PKCE is disabled for this documented confidential flow; common state checks
and single-use attempts remain active. API requests include the pinned version.
The runtime retains rotated refresh tokens and refreshes expiring grants using
the existing lifecycle. No artificial expiry is invented when the provider
omits it; that case follows the common runtime's non-expiring-token behavior.

The controlled OAuth test covers request encoding/authentication, callback,
replay rejection, two refresh rotations across storage restart, version headers
and another app user's denied access. Browser coverage, hosted MCP and live
Notion consent remain unproven. This is data authorization, not app login.

## Hosted assistant MCP

Set `settings.connectionType` to `mcp` (default `rest`). Select account mode
`assistant`, OAuth with a separate own registration using `client_secret_post`,
and scope `default`. `registerNotionMcpClient({clientName, callbackUrl}, options)`
uses the existing bounded registration helper; the caller owns authorization
and secret storage. Never reuse REST client credentials.

Notion's [MCP metadata](https://mcp.notion.com/.well-known/oauth-authorization-server)
provides the separate authority. The runtime uses S256, form token requests and
https://mcp.notion.com/mcp. Verification initializes MCP and lists tools;
`tools.call` requires the host's authorization of the exact name and arguments.
Use the ordinary connection service in assistant execution mode for assistant
permission enforcement. This mode exposes no REST operations.

The editor's Connection type field switches the credential family and creates
a new OAuth registration slot. It offers assistant-only ownership and the MCP
setup instructions, including a manual registration request and Env handoff.
Controlled tests cover registration, an ambiguous registration failure without
retry, separate endpoints, PKCE, encoding, refresh after restart and tool
discovery. Controlled browser verification covers all three modes, their setup links,
credential separation, failure recovery and reload. Live consent is untested.

## Content operations and native-framework composition

The same project-owned connection service now exposes pages.get, databases.get,
dataSources.get, blocks.list, dataSources.query, pages.create, pages.update and
blocks.append. Use database.data_sources to select a source, then read its schema.
Query with id, page_size/start_cursor and optional provider-shaped filter/sorts.
Read nested blocks separately while has_children; follow has_more/next_cursor.
Create pages with parentId, parentType (page_id or data_source_id), properties
and optional children. Update properties by page id; append children by block/page id.
Documents are bounded to64KiB; append batches1–100 blocks,256KiB total.
Read content capability is required; Insert content permits creation/append,
Update content permits property edits. Grant access to the parent pages as well.
Connection verification still only searches, never writes. Approval and rendering
belong to the app; an uncertain write is not automatically repeated.

CLI JSKIT uses service.invoke with these operations and the same file/Env config.
Other frameworks implement these documented requests using their native Notion
client and app-owned credential storage; this library contains no PHP code.
Example: pages.create can add a meeting note, then blocks.append adds an action.
**LIMITATIONS:** No embedded Notion editor, database/schema administration, file
uploads or automatic coding-chat attachment. Nested paging/rendering is app-owned.
Controlled fixtures, not live workspace or generated-app execution.

References: [data sources](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03),
[create page](https://developers.notion.com/reference/post-page),
[append blocks](https://developers.notion.com/reference/patch-block-children).
