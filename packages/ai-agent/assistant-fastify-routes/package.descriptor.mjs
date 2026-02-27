export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/assistant-fastify-routes",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/assistant-core",
    "@jskit-ai/assistant-contracts",
    "@jskit-ai/http-contracts",
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "assistant.server-routes"
    ],
    "requires": [
      "assistant.core",
      "contracts.assistant",
      "contracts.http",
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
