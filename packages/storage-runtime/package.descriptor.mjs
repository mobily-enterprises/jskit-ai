export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/storage-runtime",
  version: "0.1.39",
  kind: "runtime",
  dependsOn: [
    "@jskit-ai/kernel"
  ],
  capabilities: {
    provides: [
      "runtime.storage"
    ],
    requires: []
  },
  runtime: {
    server: {
      providerEntrypoint: "src/server/providers/StorageRuntimeServiceProvider.js",
      providers: [
        {
          entrypoint: "src/server/providers/StorageRuntimeServiceProvider.js",
          export: "StorageRuntimeServiceProvider"
        }
      ]
    },
    client: {
      providers: []
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/providers/StorageRuntimeServiceProvider",
          summary: "Exports storage runtime server provider."
        },
        {
          subpath: "./client",
          summary: "Exports no client runtime API today (reserved client entrypoint)."
        }
      ],
      containerTokens: {
        server: [
          "runtime.storage",
          "jskit.storage"
        ],
        client: []
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/kernel": "0.1.40",
        "unstorage": "^1.17.3"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [],
    text: []
  }
});
