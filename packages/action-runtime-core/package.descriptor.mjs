export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/action-runtime-core",
  "version": "0.1.0",
  "dependsOn": [],
  "capabilities": {
    "provides": [
      "runtime.actions"
    ],
    "requires": []
  },
  "runtime": {
    "server": {
      "providerEntrypoint": "src/server/index.js",
      "providers": [
        {
          "entrypoint": "src/server/providers/ActionRuntimeCoreServiceProvider.js",
          "export": "ActionRuntimeCoreServiceProvider"
        }
      ]
    },
    "client": {
      "providers": [
        {
          "entrypoint": "src/client/providers/ActionRuntimeCoreClientProvider.js",
          "export": "ActionRuntimeCoreClientProvider"
        }
      ]
    }
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
