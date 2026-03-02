export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/chat-client-runtime",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/chat-contracts",
    "@jskit-ai/runtime-env-core"
  ],
  "capabilities": {
    "provides": [
      "chat.client-runtime"
    ],
    "requires": [
      "contracts.chat",
      "runtime.env"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/chat-contracts": "0.1.0",
        "@jskit-ai/runtime-env-core": "0.1.0",
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
