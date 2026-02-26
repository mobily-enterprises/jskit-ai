export default Object.freeze({
  packVersion: 2,
  packId: "community-suite",
  version: "0.1.0",
  description: "Combined chat, social, and users profile suite.",
  options: {},
  packages: [
    "@jskit-ai/chat-contracts",
    "@jskit-ai/chat-storage-core",
    "@jskit-ai/chat-core",
    "@jskit-ai/chat-knex-mysql",
    "@jskit-ai/chat-fastify-adapter",
    "@jskit-ai/chat-client-runtime",
    "@jskit-ai/chat-client-element",
    "@jskit-ai/social-contracts",
    "@jskit-ai/social-core",
    "@jskit-ai/social-knex-mysql",
    "@jskit-ai/social-fastify-adapter",
    "@jskit-ai/social-client-runtime",
    "@jskit-ai/user-profile-core",
    "@jskit-ai/user-profile-knex-mysql",
    "@jskit-ai/profile-client-element",
    "@jskit-ai/members-admin-client-element"
  ]
});
