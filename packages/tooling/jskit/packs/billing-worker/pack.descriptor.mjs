export default Object.freeze({
  packVersion: 2,
  packId: "billing-worker",
  version: "0.1.0",
  description: "Billing service and worker processing packages.",
  options: {},
  packages: [
    "@jskit-ai/billing-provider-core",
    "@jskit-ai/entitlements-core",
    "@jskit-ai/billing-core",
    "@jskit-ai/billing-service-core",
    "@jskit-ai/billing-worker-core"
  ]
});
