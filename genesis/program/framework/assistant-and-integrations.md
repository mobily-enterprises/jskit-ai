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
