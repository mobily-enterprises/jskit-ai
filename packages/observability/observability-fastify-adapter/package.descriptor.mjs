export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/observability-fastify-adapter",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/http-contracts",
    "@jskit-ai/observability-core",
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "observability.routes"
    ],
    "requires": [
      "contracts.http",
      "observability.core",
      "runtime.server"
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
