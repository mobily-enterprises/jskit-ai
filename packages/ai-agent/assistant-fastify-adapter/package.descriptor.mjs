export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/assistant-fastify-adapter",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/assistant-core",
    "@jskit-ai/http-contracts",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/assistant-contracts"
  ],
  "capabilities": {
    "provides": [
      "assistant.routes"
    ],
    "requires": [
      "assistant.core",
      "contracts.http",
      "runtime.server",
      "contracts.assistant"
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
