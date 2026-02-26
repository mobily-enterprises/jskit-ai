export default Object.freeze({
  packVersion: 2,
  packId: "auth-base",
  version: "0.1.0",
  description: "Core authentication and policy packages.",
  options: {},
  packages: [
    "@jskit-ai/access-core",
    "@jskit-ai/rbac-core",
    "@jskit-ai/fastify-auth-policy",
    "@jskit-ai/auth-fastify-adapter"
  ]
});
