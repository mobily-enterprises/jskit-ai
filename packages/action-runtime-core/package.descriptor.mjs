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
  "metadata": {
    "apiSummary": {
      "surfaces": [
        {
          "subpath": "./client",
          "summary": "Exports action runtime APIs for client use plus ActionRuntimeCoreClientProvider."
        },
        {
          "subpath": "./server",
          "summary": "Exports action runtime APIs for server use plus contributor helpers and ActionRuntimeCoreServiceProvider."
        },
        {
          "subpath": "./shared",
          "summary": "Exports shared action runtime APIs and contracts (with structured subpaths such as ./shared/contracts, ./shared/registry, ./shared/pipeline, ./shared/policies)."
        }
      ],
      "containerTokens": {
        "server": [
          "runtime.actions",
          "actionRegistry",
          "actionExecutor"
        ],
        "client": [
          "runtime.actions.client"
        ]
      }
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
