export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/platform-server-runtime",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "runtime.platform-server"
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
