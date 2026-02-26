export default Object.freeze({
  packVersion: 2,
  packId: "workspace-core",
  version: "0.1.0",
  description: "Workspace service core, storage, and API routes.",
  options: {},
  packages: [
    "@jskit-ai/workspace-console-core",
    "@jskit-ai/workspace-knex-mysql",
    "@jskit-ai/workspace-service-core",
    "@jskit-ai/workspace-fastify-adapter"
  ]
});
