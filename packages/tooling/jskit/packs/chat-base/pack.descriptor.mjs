export default Object.freeze({
  packVersion: 2,
  packId: "chat-base",
  version: "0.1.0",
  description: "Chat contracts, storage, API adapter, and client runtime.",
  options: {},
  packages: [
    "@jskit-ai/chat-contracts",
    "@jskit-ai/chat-storage-core",
    "@jskit-ai/chat-core",
    "@jskit-ai/chat-knex-mysql",
    "@jskit-ai/chat-fastify-adapter",
    "@jskit-ai/chat-client-runtime",
    "@jskit-ai/chat-client-element"
  ]
});
