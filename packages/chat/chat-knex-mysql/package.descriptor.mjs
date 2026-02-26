export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/chat-knex-mysql",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/knex-mysql-core",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/chat-storage-core"
  ],
  "capabilities": {
    "provides": [
      "chat.storage.mysql"
    ],
    "requires": [
      "db-provider",
      "runtime.server",
      "chat.storage"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/knex-mysql-core": "0.1.0",
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
