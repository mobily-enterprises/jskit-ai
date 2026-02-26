export default Object.freeze({
  packVersion: 2,
  packId: "api-shell",
  version: "0.1.0",
  description: "Core shell with API contract packages.",
  options: {},
  packages: [
    "@jskit-ai/module-framework-core",
    "@jskit-ai/runtime-env-core",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/platform-server-runtime",
    "@jskit-ai/action-runtime-core",
    "@jskit-ai/http-contracts",
    "@jskit-ai/realtime-contracts",
    "@jskit-ai/health-fastify-adapter"
  ]
});
