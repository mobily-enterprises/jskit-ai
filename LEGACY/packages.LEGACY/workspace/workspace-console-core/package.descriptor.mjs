export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/workspace-console-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/rbac-core"
  ],
  "capabilities": {
    "provides": [
      "workspace.console.core"
    ],
    "requires": [
      "auth.rbac"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/rbac-core": "0.1.0"
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
