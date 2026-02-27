export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/health-fastify-routes",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/http-contracts"
  ],
  "capabilities": {
    "provides": [
      "runtime.health-server-routes"
    ],
    "requires": [
      "runtime.server",
      "contracts.http"
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
