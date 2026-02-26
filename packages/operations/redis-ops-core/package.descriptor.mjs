export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/redis-ops-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "ops.redis"
    ],
    "requires": [
      "runtime.server"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/server-runtime-core": "0.1.0",
        "bullmq": "^5.69.4",
        "ioredis": "^5.9.3"
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
