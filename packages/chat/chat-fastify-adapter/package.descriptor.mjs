export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/chat-fastify-adapter",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/http-contracts",
    "@jskit-ai/chat-core",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/chat-contracts"
  ],
  "capabilities": {
    "provides": [
      "chat.routes"
    ],
    "requires": [
      "contracts.http",
      "chat.core",
      "runtime.server",
      "contracts.chat"
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
