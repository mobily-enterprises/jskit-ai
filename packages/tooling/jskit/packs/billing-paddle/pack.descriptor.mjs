export default Object.freeze({
  packVersion: 2,
  packId: "billing-paddle",
  version: "0.1.0",
  description: "Billing base with Paddle provider package.",
  options: {},
  packages: [
    "@jskit-ai/billing-provider-core",
    "@jskit-ai/billing-provider-paddle",
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
