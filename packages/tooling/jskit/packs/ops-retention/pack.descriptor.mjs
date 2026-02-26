export default Object.freeze({
  packVersion: 2,
  packId: "ops-retention",
  version: "0.1.0",
  description: "Operational retention workers and Redis queue support.",
  options: {},
  packages: [
    "@jskit-ai/redis-ops-core",
    "@jskit-ai/retention-core"
  ]
});
