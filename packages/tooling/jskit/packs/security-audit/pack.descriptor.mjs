export default Object.freeze({
  packVersion: 2,
  packId: "security-audit",
  version: "0.1.0",
  description: "Security audit capability with knex/mysql storage adapter.",
  options: {},
  packages: [
    "@jskit-ai/security-audit-core",
    "@jskit-ai/security-audit-knex-mysql"
  ]
});
