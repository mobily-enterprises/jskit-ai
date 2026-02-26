export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/billing-knex-mysql",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/entitlements-knex-mysql",
    "@jskit-ai/knex-mysql-core",
    "@jskit-ai/billing-core"
  ],
  "capabilities": {
    "provides": [
      "billing.store.mysql"
    ],
    "requires": [
      "billing.entitlements.store.mysql",
      "db-provider",
      "billing.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/entitlements-knex-mysql": "0.1.0",
        "@jskit-ai/knex-mysql-core": "0.1.0"
      },
      "dev": {}
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": []
  }
});
