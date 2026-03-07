export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/database-runtime",
  version: "0.1.0",
  dependsOn: [
    "@jskit-ai/kernel"
  ],
  capabilities: {
    provides: [
      "runtime.database"
    ],
    requires: [
      "runtime.database.driver"
    ]
  },
  runtime: {
    server: {
      providerEntrypoint: "src/server/index.js",
      providers: [
        {
          entrypoint: "src/server/providers/DatabaseRuntimeServiceProvider.js",
          export: "DatabaseRuntimeServiceProvider"
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
          summary: "Exports DatabaseRuntimeServiceProvider plus registerDatabaseRuntime for server container wiring."
        },
        {
          subpath: "./shared",
          summary: "Exports shared Knex runtime utilities (transaction manager, repository helpers, retention/json/date/dialect helpers)."
        },
        {
          subpath: "./client",
          summary: "Exports no runtime API today (reserved client entrypoint)."
        }
      ],
      containerTokens: {
        server: [
          "runtime.database",
          "runtime.database.driver"
        ],
        client: []
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/kernel": "0.1.0"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: []
  }
});
