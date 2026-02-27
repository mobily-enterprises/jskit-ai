export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/communications-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/communications-contracts",
    "@jskit-ai/communications-provider-core",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/http-contracts"
  ],
  "capabilities": {
    "provides": [
      "communications.core",
      "communications.routes"
    ],
    "requires": [
      "contracts.communications",
      "communications.provider",
      "contracts.http",
      "communications.core",
      "runtime.server"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/communications-contracts": "0.1.0",
        "@jskit-ai/communications-provider-core": "0.1.0",
        "@jskit-ai/http-contracts": "0.1.0"
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
