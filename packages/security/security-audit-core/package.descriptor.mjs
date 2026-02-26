export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/security-audit-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "security.audit.core"
    ],
    "requires": [
      "runtime.server",
      "db-provider"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
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
