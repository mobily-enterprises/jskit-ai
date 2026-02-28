export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/billing-provider-paddle",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/billing-provider-core",
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "billing.provider",
      "billing.provider.paddle"
    ],
    "requires": [
      "billing.provider-contract",
      "runtime.server"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/billing-provider-core": "0.1.0",
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
