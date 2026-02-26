export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/social-client-runtime",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/social-contracts"
  ],
  "capabilities": {
    "provides": [
      "social.client-runtime"
    ],
    "requires": [
      "contracts.social"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/social-contracts": "0.1.0",
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
