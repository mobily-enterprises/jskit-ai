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
      providerEntrypoint: "src/server/providers/DatabaseRuntimeServiceProvider.js",
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
        "@jskit-ai/kernel": "0.1.0",
        "dotenv": "^16.4.5",
        "knex": "^3.1.0"
      },
      dev: {}
    },
    packageJson: {
      scripts: {
        "db:migrate": "knex --knexfile ./knexfile.js migrate:latest",
        "db:migrate:rollback": "knex --knexfile ./knexfile.js migrate:rollback",
        "db:migrate:status": "knex --knexfile ./knexfile.js migrate:list"
      }
    },
    procfile: {},
    files: [
      {
        from: "templates/knexfile.js",
        to: "knexfile.js",
        reason: "Install root Knex configuration so app scripts can run migrations through Knex CLI.",
        category: "database-runtime",
        id: "database-runtime-knexfile"
      },
      {
        from: "templates/migrations/.gitkeep",
        to: "migrations/.gitkeep",
        reason: "Ensure migrations directory exists so Knex migration commands can run before any module installs migrations.",
        category: "database-runtime",
        id: "database-runtime-migrations-dir"
      }
    ]
  }
});
