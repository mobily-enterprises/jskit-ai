export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/retention-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/redis-ops-core"
  ],
  "capabilities": {
    "provides": [
      "ops.retention"
    ],
    "requires": [
      "ops.redis"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/redis-ops-core": "0.1.0"
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
