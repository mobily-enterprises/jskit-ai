export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/billing-fastify-adapter",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/billing-service-core",
    "@jskit-ai/http-contracts",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/billing-core"
  ],
  "capabilities": {
    "provides": [
      "billing.routes"
    ],
    "requires": [
      "billing.service",
      "contracts.http",
      "runtime.server",
      "billing.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@fastify/type-provider-typebox": "^6.1.0",
        "@jskit-ai/billing-service-core": "0.1.0",
        "@jskit-ai/http-contracts": "0.1.0",
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
