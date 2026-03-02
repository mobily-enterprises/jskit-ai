export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/action-runtime-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/module-framework-core"
  ],
  "capabilities": {
    "provides": [
      "runtime.actions"
    ],
    "requires": [
      "runtime.module-framework"
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
