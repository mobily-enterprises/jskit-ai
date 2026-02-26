export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/communications-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/communications-contracts",
    "@jskit-ai/communications-provider-core"
  ],
  "capabilities": {
    "provides": [
      "communications.core"
    ],
    "requires": [
      "contracts.communications",
      "communications.provider"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/communications-contracts": "0.1.0",
        "@jskit-ai/communications-provider-core": "0.1.0"
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
