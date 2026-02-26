export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/chat-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/rbac-core",
    "@jskit-ai/chat-storage-core",
    "@jskit-ai/chat-contracts"
  ],
  "capabilities": {
    "provides": [
      "chat.core"
    ],
    "requires": [
      "runtime.server",
      "auth.rbac",
      "chat.storage",
      "contracts.chat"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/knex-mysql-core": "0.1.0",
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
