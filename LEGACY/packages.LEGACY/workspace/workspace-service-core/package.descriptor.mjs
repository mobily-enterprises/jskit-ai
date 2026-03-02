export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/workspace-service-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/workspace-console-core",
    "@jskit-ai/access-core",
    "@jskit-ai/rbac-core",
    "@jskit-ai/runtime-env-core",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/jskit-knex"
  ],
  "capabilities": {
    "provides": [
      "workspace.service",
      "workspace.store"
    ],
    "requires": [
      "workspace.console.core",
      "auth.access",
      "auth.rbac",
      "runtime.env",
      "runtime.server",
      "db.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/access-core": "0.1.0",
        "@jskit-ai/assistant-core": "0.1.0",
        "@jskit-ai/assistant-transcripts-core": "0.1.0",
        "@jskit-ai/jskit-knex": "0.1.0",
        "@jskit-ai/rbac-core": "0.1.0",
        "@jskit-ai/runtime-env-core": "0.1.0",
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
