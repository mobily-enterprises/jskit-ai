export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/assistant-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/assistant-contracts"
  ],
  "capabilities": {
    "provides": [
      "assistant.core"
    ],
    "requires": [
      "runtime.server",
      "contracts.assistant"
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
