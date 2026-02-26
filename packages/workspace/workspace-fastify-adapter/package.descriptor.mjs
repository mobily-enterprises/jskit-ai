export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/workspace-fastify-adapter",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/workspace-console-core",
    "@jskit-ai/access-core",
    "@jskit-ai/rbac-core",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/http-contracts"
  ],
  "capabilities": {
    "provides": [
      "workspace.routes"
    ],
    "requires": [
      "workspace.console.core",
      "auth.access",
      "auth.rbac",
      "runtime.server",
      "contracts.http"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@fastify/type-provider-typebox": "^6.1.0",
        "@jskit-ai/access-core": "0.1.0",
        "@jskit-ai/http-contracts": "0.1.0",
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
