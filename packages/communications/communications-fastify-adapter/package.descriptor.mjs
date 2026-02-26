export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/communications-fastify-adapter",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/communications-contracts",
    "@jskit-ai/http-contracts",
    "@jskit-ai/communications-core",
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "communications.routes"
    ],
    "requires": [
      "contracts.communications",
      "contracts.http",
      "communications.core",
      "runtime.server"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/communications-contracts": "0.1.0",
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
