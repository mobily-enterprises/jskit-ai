export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/assistant-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/assistant-contracts",
    "@jskit-ai/http-contracts"
  ],
  "capabilities": {
    "provides": [
      "assistant.core",
      "assistant.routes"
    ],
    "requires": [
      "runtime.server",
      "contracts.assistant",
      "assistant.core",
      "assistant.provider",
      "contracts.http"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/server-runtime-core": "0.1.0",
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
