export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/assistant-provider-openai",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/assistant-core"
  ],
  "capabilities": {
    "provides": [
      "assistant.provider.openai",
      "assistant.provider"
    ],
    "requires": [
      "assistant.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "openai": "^6.22.0"
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
