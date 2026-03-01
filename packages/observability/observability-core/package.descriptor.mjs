export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/observability-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/workspace-console-core",
    "@jskit-ai/value-app-config-shared"
  ],
  "capabilities": {
    "provides": [
      "observability.core"
    ],
    "requires": [
      "runtime.server",
      "workspace.console.core"
    ]
  },
  "runtime": {
    "server": {
      "entrypoint": "src/shared/server.js",
      "export": "createServerContributions"
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/server-runtime-core": "0.1.0",
        "@jskit-ai/workspace-console-core": "0.1.0"
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
