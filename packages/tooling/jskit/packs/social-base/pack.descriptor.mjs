export default Object.freeze({
  packVersion: 2,
  packId: "social-base",
  version: "0.1.0",
  description: "Social contracts, storage, adapter, and client runtime.",
  options: {},
  packages: [
    "@jskit-ai/social-contracts",
    "@jskit-ai/social-core",
    "@jskit-ai/social-knex-mysql",
    "@jskit-ai/social-fastify-adapter",
    "@jskit-ai/social-client-runtime"
  ]
});
