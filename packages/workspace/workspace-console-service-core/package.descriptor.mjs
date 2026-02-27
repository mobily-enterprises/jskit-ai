export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/workspace-console-service-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/action-runtime-core",
    "@jskit-ai/workspace-console-core",
    "@jskit-ai/workspace-console-knex-mysql",
    "@jskit-ai/access-core",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/billing-service-core"
  ],
  "capabilities": {
    "provides": [
      "workspace.console.service"
    ],
    "requires": [
      "workspace.console.core",
      "workspace.console.store.mysql",
      "auth.access",
      "runtime.server",
      "billing.service",
      "runtime.actions"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/action-runtime-core": "0.1.0",
        "@jskit-ai/access-core": "0.1.0",
        "@jskit-ai/assistant-core": "0.1.0",
        "@jskit-ai/billing-service-core": "0.1.0",
        "@jskit-ai/knex-mysql-core": "0.1.0",
        "@jskit-ai/server-runtime-core": "0.1.0",
        "@jskit-ai/workspace-console-core": "0.1.0"
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
