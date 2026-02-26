export default Object.freeze({
  packVersion: 2,
  packId: "workspace-admin-suite",
  version: "0.1.0",
  description: "Combined workspace service and console administration suite.",
  options: {},
  packages: [
    "@jskit-ai/workspace-console-core",
    "@jskit-ai/workspace-console-knex-mysql",
    "@jskit-ai/workspace-console-service-core",
    "@jskit-ai/workspace-knex-mysql",
    "@jskit-ai/workspace-service-core",
    "@jskit-ai/workspace-fastify-adapter",
    "@jskit-ai/console-fastify-adapter",
    "@jskit-ai/console-errors-fastify-adapter",
    "@jskit-ai/settings-fastify-adapter"
  ]
});
