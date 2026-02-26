export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/observability-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "observability.core"
    ],
    "requires": [
      "runtime.server"
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
