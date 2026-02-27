export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/chat-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/rbac-core",
    "@jskit-ai/chat-storage-core",
    "@jskit-ai/chat-contracts",
    "@jskit-ai/http-contracts",
    "@jskit-ai/jskit-knex"
  ],
  "capabilities": {
    "provides": [
      "chat.core",
      "chat.routes"
    ],
    "requires": [
      "runtime.server",
      "auth.rbac",
      "chat.storage",
      "contracts.chat",
      "contracts.http",
      "chat.core",
      "db.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/jskit-knex": "0.1.0",
        "@jskit-ai/rbac-core": "0.1.0",
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
