export default Object.freeze({
  packVersion: 2,
  packId: "workspace-console",
  version: "0.1.0",
  description: "Workspace console routes, storage, and service packages.",
  options: {},
  packages: [
    "@jskit-ai/workspace-console-core",
    "@jskit-ai/workspace-console-knex-mysql",
    "@jskit-ai/workspace-console-service-core",
    "@jskit-ai/console-fastify-adapter",
    "@jskit-ai/console-errors-fastify-adapter",
    "@jskit-ai/settings-fastify-adapter"
  ]
});
