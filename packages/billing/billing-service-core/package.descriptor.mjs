export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/billing-service-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/action-runtime-core",
    "@jskit-ai/access-core",
    "@jskit-ai/billing-provider-core",
    "@jskit-ai/entitlements-core",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/billing-core",
    "@jskit-ai/jskit-knex",
    "@jskit-ai/workspace-console-core"
  ],
  "capabilities": {
    "provides": [
      "billing.service"
    ],
    "requires": [
      "runtime.actions",
      "auth.access",
      "billing.provider",
      "billing.entitlements.core",
      "runtime.server",
      "billing.core",
      "db.core",
      "workspace.console.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/action-runtime-core": "0.1.0",
        "@jskit-ai/access-core": "0.1.0",
        "@jskit-ai/billing-core": "0.1.0",
        "@jskit-ai/billing-provider-core": "0.1.0",
        "@jskit-ai/entitlements-core": "0.1.0",
        "@jskit-ai/server-runtime-core": "0.1.0",
        "@jskit-ai/jskit-knex": "0.1.0",
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
