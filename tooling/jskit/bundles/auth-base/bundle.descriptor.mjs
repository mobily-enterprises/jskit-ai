export default Object.freeze({
  bundleVersion: 1,
  bundleId: "auth-base",
  version: "0.1.0",
  description: "Core authentication web, policy, and RBAC packages.",
  packages: [
    "@jskit-ai/access-core",
    "@jskit-ai/rbac-core",
    "@jskit-ai/fastify-auth-policy",
    "@jskit-ai/auth-web"
  ]
});
