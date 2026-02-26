export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/email-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/communications-provider-core"
  ],
  "capabilities": {
    "provides": [
      "communications.email"
    ],
    "requires": [
      "communications.provider"
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
