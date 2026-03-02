export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/workspace-console-service-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/action-runtime-core",
    "@jskit-ai/workspace-console-core",
    "@jskit-ai/access-core",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/jskit-knex"
  ],
  "capabilities": {
    "provides": [
      "workspace.console.service",
      "workspace.console.store"
    ],
    "requires": [
      "workspace.console.core",
      "auth.access",
      "runtime.server",
      "runtime.actions",
      "db.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/action-runtime-core": "0.1.0",
        "@jskit-ai/access-core": "0.1.0",
        "@jskit-ai/assistant-core": "0.1.0",
        "@jskit-ai/jskit-knex": "0.1.0",
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
