export default Object.freeze({
  packVersion: 2,
  packId: "billing-base",
  version: "0.1.0",
  description: "Billing domain core, service, storage, and API adapter.",
  options: {},
  packages: [
    "@jskit-ai/billing-provider-core",
    "@jskit-ai/entitlements-core",
    "@jskit-ai/entitlements-knex-mysql",
    "@jskit-ai/billing-core",
    "@jskit-ai/billing-service-core",
    "@jskit-ai/billing-fastify-adapter",
    "@jskit-ai/billing-knex-mysql",
    "@jskit-ai/billing-plan-client-element",
    "@jskit-ai/billing-commerce-client-element",
    "@jskit-ai/billing-console-admin-client-element"
  ]
});
