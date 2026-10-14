# Assistants and external integrations

Provides conversation runtimes, provider selection, voice support, reusable
connector account management, and focused third-party operations.

## Sources

- Main: `packages/assistant-core/src/server/conversation/provider.js`
- `packages/assistant-runtime/src/server/AssistantProvider.js`
- `packages/assistant-voice/src/server/index.js`
- `packages/connectors-core/src/server/ConnectorsFeature.js`
- `packages/connectors-catalog/src/shared/definitions.js`

## Public contract

Applications select supported assistant and connector providers, retain their
own conversation and connection identities, and supply credentials through
server-side environment references. Conversations preserve provider lifecycle,
streaming, attachment, recovery, and storage contracts. Connector operations
remain scoped to the application and user or workspace that owns the account.

Transcript readers accept server-owned `pageUnit: "messages"` to count individual
user, assistant and system messages, excluding reasoning and commentary. The
default remains whole stored turns for internal consumers. The shared browser
page-size default is ten. Hosts select message pagination for browser reads.
History reads return an opaque `nextBeforeTurnId` cursor, including a message-role
boundary when a page splits a stored turn. Browser bindings follow that cursor
and merge partial turns without losing either half. Live patches retain whole
boundary turns and their progress rather than trimming by raw storage row count.
Pagination is a read-only projection; saved identities and records do not change.

Native conversations optionally report content-free delivery timings through
`onDeliveryTiming`. One shared observer supplies milestone names, monotonic
durations and message attribution for Codex, Claude and OpenCode; their original
native owners mark acknowledgement before receipt persistence. Observer work
does not block dispatch or alter saved conversation data.

An OpenCode process acquired for helpers can exist before the main conversation
has a native ID. Stopping its idle main turn is a no-op; session closure still
drains owned helpers and releases the process without interrupting peer sessions.
An active turn with a missing native identity remains an error, never a
successful Stop.
