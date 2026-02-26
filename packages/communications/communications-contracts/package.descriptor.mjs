export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/communications-contracts",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/http-contracts"
  ],
  "capabilities": {
    "provides": [
      "contracts.communications"
    ],
    "requires": [
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
