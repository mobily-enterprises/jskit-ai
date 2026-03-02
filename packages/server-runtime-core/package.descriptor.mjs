export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/server-runtime-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/module-framework-core",
    "@jskit-ai/runtime-env-core",
    "@jskit-ai/surface-routing"
  ],
  "capabilities": {
    "provides": [
      "runtime.server"
    ],
    "requires": [
      "runtime.module-framework",
      "runtime.env",
      "runtime.surface-routing"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/surface-routing": "0.1.0"
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
