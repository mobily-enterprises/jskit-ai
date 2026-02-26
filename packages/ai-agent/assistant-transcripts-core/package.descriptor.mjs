export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/assistant-transcripts-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/assistant-core"
  ],
  "capabilities": {
    "provides": [
      "assistant.transcripts.core"
    ],
    "requires": [
      "runtime.server",
      "assistant.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
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
