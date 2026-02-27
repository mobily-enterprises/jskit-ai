export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/entitlements-knex-mysql",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/entitlements-core",
    "@jskit-ai/jskit-knex"
  ],
  "capabilities": {
    "provides": [
      "billing.entitlements.store.mysql"
    ],
    "requires": [
      "billing.entitlements.core",
      "db-provider"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {},
      "dev": {}
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": []
  }
});
