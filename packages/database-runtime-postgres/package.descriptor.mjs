export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/database-runtime-postgres",
  version: "0.1.0",
  dependsOn: [
    "@jskit-ai/database-runtime"
  ],
  capabilities: {
    provides: [
      "runtime.database.driver",
      "runtime.database.driver.postgres"
    ],
    requires: [
      "runtime.database"
    ]
  },
  runtime: {
    server: {
      providerEntrypoint: "src/server/index.js",
      providers: [
        {
          entrypoint: "src/server/providers/DatabaseRuntimePostgresServiceProvider.js",
          export: "DatabaseRuntimePostgresServiceProvider"
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
          summary: "Exports Postgres database runtime provider."
        },
        {
          subpath: "./shared",
          summary: "Exports Postgres dialect metadata helpers."
        },
        {
          subpath: "./client",
          summary: "Exports no runtime API today (reserved client entrypoint)."
        }
      ],
      containerTokens: {
        server: [
          "runtime.database.driver.postgres"
        ],
        client: []
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/database-runtime": "0.1.0"
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
