export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/assistant-transcripts-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/assistant-core",
    "@jskit-ai/workspace-console-core",
    "@jskit-ai/jskit-knex"
  ],
  "capabilities": {
    "provides": [
      "assistant.transcripts.core",
      "assistant.transcripts.store"
    ],
    "requires": [
      "runtime.server",
      "assistant.core",
      "workspace.console.core",
      "assistant.transcripts.core",
      "db.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/server-runtime-core": "0.1.0",
        "@jskit-ai/workspace-console-core": "0.1.0",
        "@jskit-ai/jskit-knex": "0.1.0"
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
