export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/billing-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/billing-provider-core"
  ],
  "capabilities": {
    "provides": [
      "billing.core"
    ],
    "requires": [
      "runtime.server",
      "billing.provider"
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
