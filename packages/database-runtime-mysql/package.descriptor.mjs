export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/database-runtime-mysql",
  version: "0.1.16",
  kind: "runtime",
  options: {
    "db-host": {
      required: false,
      values: [],
      defaultValue: "localhost",
      promptLabel: "Database host",
      promptHint: "MySQL host (for example 127.0.0.1)"
    },
    "db-port": {
      required: false,
      values: [],
      defaultValue: "3306",
      promptLabel: "Database port",
      promptHint: "MySQL port (usually 3306)"
    },
    "db-name": {
      required: true,
      values: [],
      promptLabel: "Database name",
      promptHint: "Schema/database name to connect to"
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
      "runtime.database.driver.mysql"
    ],
    requires: [
      "runtime.database"
    ]
  },
  runtime: {
    server: {
      providerEntrypoint: "src/server/providers/DatabaseRuntimeMysqlServiceProvider.js",
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
        "@jskit-ai/database-runtime": "0.1.17",
        "mysql2": "^3.11.2"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [],
    text: [
      {
        file: ".env",
        op: "upsert-env",
        key: "DB_CLIENT",
        value: "mysql2",
        reason: "Configure database client driver for runtime wiring.",
        category: "runtime-config",
        id: "database-client-mysql"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "DB_HOST",
        value: "${option:db-host}",
        reason: "Configure database host.",
        category: "runtime-config",
        id: "database-host"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "DB_PORT",
        value: "${option:db-port}",
        reason: "Configure database port.",
        category: "runtime-config",
        id: "database-port"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "DB_NAME",
        value: "${option:db-name}",
        reason: "Configure database name.",
        category: "runtime-config",
        id: "database-name"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "DB_USER",
        value: "${option:db-user}",
        reason: "Configure database user.",
        category: "runtime-config",
        id: "database-user"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "DB_PASSWORD",
        value: "${option:db-password}",
        reason: "Configure database password.",
        category: "runtime-config",
        id: "database-password"
      }
    ]
  }
});
