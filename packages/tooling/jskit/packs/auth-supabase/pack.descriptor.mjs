export default Object.freeze({
  packVersion: 2,
  packId: "auth-supabase",
  version: "0.1.0",
  description: "Supabase authentication provider overlay.",
  options: {},
  packages: [
    "@jskit-ai/access-core",
    "@jskit-ai/rbac-core",
    "@jskit-ai/fastify-auth-policy",
    "@jskit-ai/auth-fastify-adapter",
    "@jskit-ai/auth-provider-supabase-core"
  ]
});
