export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/social-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/social-contracts"
  ],
  "capabilities": {
    "provides": [
      "social.core"
    ],
    "requires": [
      "runtime.server",
      "contracts.social"
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
