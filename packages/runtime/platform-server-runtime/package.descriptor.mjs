export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/platform-server-runtime",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/kernel-core",
    "@jskit-ai/http-fastify-core",
    "@jskit-ai/support-core"
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
        "@jskit-ai/server-runtime-core": "0.1.0",
        "@jskit-ai/kernel-core": "0.1.0",
        "@jskit-ai/http-fastify-core": "0.1.0",
        "@jskit-ai/support-core": "0.1.0"
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
