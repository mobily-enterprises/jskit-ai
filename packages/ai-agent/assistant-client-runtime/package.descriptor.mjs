export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/assistant-client-runtime",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/assistant-contracts"
  ],
  "capabilities": {
    "provides": [
      "assistant.client-runtime"
    ],
    "requires": [
      "contracts.assistant"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/assistant-contracts": "0.1.0",
        "@tanstack/vue-query": "^5.90.5",
        "vue": "^3.5.13"
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
