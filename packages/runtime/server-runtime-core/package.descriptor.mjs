export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/server-runtime-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/module-framework-core",
    "@jskit-ai/runtime-env-core"
  ],
  "capabilities": {
    "provides": [
      "runtime.server"
    ],
    "requires": [
      "runtime.module-framework",
      "runtime.env"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {},
      "dev": {}
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": []
  }
});
