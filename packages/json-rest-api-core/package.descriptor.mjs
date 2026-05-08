export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/json-rest-api-core",
  version: "0.1.10",
  kind: "runtime",
  description: "Shared internal json-rest-api host runtime for JSKIT server packages.",
  dependsOn: [
    "@jskit-ai/database-runtime",
    "@jskit-ai/kernel"
  ],
  capabilities: {
    provides: [
      "json-rest-api.core"
    ],
    requires: [
      "runtime.database"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/JsonRestApiCoreServiceProvider.js",
          export: "JsonRestApiCoreServiceProvider"
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
          subpath: "./server",
          summary: "Exports the shared internal json-rest-api host token and host registration helpers."
        }
      ],
      containerTokens: {
        server: [
          "internal.json-rest-api"
        ],
        client: []
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
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
