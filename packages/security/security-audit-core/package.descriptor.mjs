export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/security-audit-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/jskit-knex"
  ],
  "capabilities": {
    "provides": [
      "security.audit.core",
      "security.audit.store"
    ],
    "requires": [
      "runtime.server",
      "db.core",
      "security.audit.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/server-runtime-core": "0.1.0",
        "@jskit-ai/jskit-knex": "0.1.0"
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
