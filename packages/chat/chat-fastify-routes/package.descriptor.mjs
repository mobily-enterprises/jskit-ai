export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/chat-fastify-routes",
  "version": "0.1.0",
  "description": "Fastify controller/routes/schema for chat HTTP endpoints.",
  "dependsOn": [
    "@jskit-ai/chat-core",
    "@jskit-ai/http-contracts",
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "chat.server-routes"
    ],
    "requires": [
      "chat.core",
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
