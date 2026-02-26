export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/security-audit-knex-mysql",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/security-audit-core",
    "@jskit-ai/knex-mysql-core"
  ],
  "capabilities": {
    "provides": [
      "security.audit.store"
    ],
    "requires": [
      "security.audit.core",
      "db-provider"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/knex-mysql-core": "0.1.0",
        "@jskit-ai/server-runtime-core": "0.1.0"
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
