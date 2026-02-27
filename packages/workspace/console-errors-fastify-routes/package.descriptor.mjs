export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/console-errors-fastify-routes",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/http-contracts",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/observability-core"
  ],
  "capabilities": {
    "provides": [
      "workspace.console-errors.server-routes"
    ],
    "requires": [
      "contracts.http",
      "runtime.server",
      "observability.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
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
