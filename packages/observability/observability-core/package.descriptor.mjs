export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/observability-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/workspace-console-core",
    "@jskit-ai/http-contracts"
  ],
  "capabilities": {
    "provides": [
      "observability.core",
      "observability.routes"
    ],
    "requires": [
      "runtime.server",
      "workspace.console.core",
      "contracts.http",
      "observability.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/server-runtime-core": "0.1.0",
        "@jskit-ai/workspace-console-core": "0.1.0",
        "@fastify/type-provider-typebox": "^6.1.0",
        "@jskit-ai/http-contracts": "0.1.0"
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
