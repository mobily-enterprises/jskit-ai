export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/chat-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/rbac-core",
    "@jskit-ai/chat-storage-core",
    "@jskit-ai/chat-contracts",
    "@jskit-ai/jskit-knex"
  ],
  "capabilities": {
    "provides": [
      "chat.core"
    ],
    "requires": [
      "runtime.server",
      "auth.rbac",
      "chat.storage",
      "contracts.chat",
      "db.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/jskit-knex": "0.1.0",
        "@jskit-ai/rbac-core": "0.1.0",
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
