export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/assistant-transcripts-knex-mysql",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/assistant-transcripts-core",
    "@jskit-ai/knex-mysql-core",
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "assistant.transcripts.store.mysql"
    ],
    "requires": [
      "assistant.transcripts.core",
      "db-provider",
      "runtime.server"
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
