export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/database-runtime-mysql",
  version: "0.1.0",
  dependsOn: [
    "@jskit-ai/database-runtime"
  ],
  capabilities: {
    provides: [
      "runtime.database.driver",
      "runtime.database.driver.mysql"
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
          entrypoint: "src/server/providers/DatabaseRuntimeMysqlServiceProvider.js",
          export: "DatabaseRuntimeMysqlServiceProvider"
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
          summary: "Exports MySQL database runtime provider."
        },
        {
          subpath: "./shared",
          summary: "Exports MySQL dialect metadata helpers."
        },
        {
          subpath: "./client",
          summary: "Exports no runtime API today (reserved client entrypoint)."
        }
      ],
      containerTokens: {
        server: [
          "runtime.database.driver.mysql"
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
