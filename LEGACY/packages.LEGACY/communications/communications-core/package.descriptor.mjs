export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/communications-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/communications-provider-core"
  ],
  "capabilities": {
    "provides": [
      "communications.core"
    ],
    "requires": [
      "communications.provider-contract"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
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
