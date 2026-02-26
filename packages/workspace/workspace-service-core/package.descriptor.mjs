export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/workspace-service-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/workspace-console-core",
    "@jskit-ai/workspace-knex-mysql",
    "@jskit-ai/access-core",
    "@jskit-ai/rbac-core",
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "workspace.service"
    ],
    "requires": [
      "workspace.console.core",
      "workspace.store.mysql",
      "auth.access",
      "auth.rbac",
      "runtime.server"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/access-core": "0.1.0",
        "@jskit-ai/assistant-core": "0.1.0",
        "@jskit-ai/assistant-transcripts-core": "0.1.0",
        "@jskit-ai/knex-mysql-core": "0.1.0",
        "@jskit-ai/rbac-core": "0.1.0",
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
