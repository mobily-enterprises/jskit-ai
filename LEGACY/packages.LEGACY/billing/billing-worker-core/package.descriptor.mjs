export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/billing-worker-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/billing-service-core",
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "billing.worker"
    ],
    "requires": [
      "billing.service",
      "runtime.server"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/billing-service-core": "0.1.0",
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
