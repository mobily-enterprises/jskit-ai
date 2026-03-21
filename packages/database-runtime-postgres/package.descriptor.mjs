import { createDatabaseRuntimeEnvTextMutations } from "@jskit-ai/database-runtime/shared/packageDescriptorMutations";

export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/database-runtime-postgres",
  version: "0.1.0",
  options: {
    "db-host": {
      required: false,
      values: [],
      defaultValue: "localhost",
      promptLabel: "Database host",
      promptHint: "Postgres host (for example 127.0.0.1)"
    },
    "db-port": {
      required: false,
      values: [],
      defaultValue: "5432",
      promptLabel: "Database port",
      promptHint: "Postgres port (usually 5432)"
    },
    "db-name": {
      required: true,
      values: [],
      promptLabel: "Database name",
      promptHint: "Database name to connect to"
    },
    "db-user": {
      required: true,
      values: [],
      promptLabel: "Database user",
      promptHint: "Database username"
    },
    "db-password": {
      required: true,
      values: [],
      inputType: "password",
      promptLabel: "Database password",
      promptHint: "Database password"
    }
  },
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
      providerEntrypoint: "src/server/providers/DatabaseRuntimePostgresServiceProvider.js",
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
        "@jskit-ai/database-runtime": "0.1.0",
        "pg": "^8.13.1"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [],
    text: createDatabaseRuntimeEnvTextMutations({
      databaseClient: "pg",
      databaseClientMutationId: "database-client-postgres"
    })
  }
});
