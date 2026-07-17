import { DIALECT_ID } from "./src/shared/dialect.js";

const CI_DATABASE = Object.freeze({
  host: "127.0.0.1",
  hostPort: "54320",
  containerPort: "5432",
  name: "jskit_ci",
  user: "jskit_ci",
  password: "jskit_ci_only_password"
});

export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/database-runtime-postgres",
  version: "0.1.116",
  kind: "runtime",
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
  ci: {
    environment: {
      DB_CLIENT: DIALECT_ID,
      DB_HOST: CI_DATABASE.host,
      DB_PORT: CI_DATABASE.hostPort,
      DB_NAME: CI_DATABASE.name,
      DB_USER: CI_DATABASE.user,
      DB_PASSWORD: CI_DATABASE.password
    },
    services: [
      {
        id: "postgres",
        image: "postgres:16",
        environment: {
          POSTGRES_DB: CI_DATABASE.name,
          POSTGRES_USER: CI_DATABASE.user,
          POSTGRES_PASSWORD: CI_DATABASE.password
        },
        ports: [`${CI_DATABASE.hostPort}:${CI_DATABASE.containerPort}`],
        healthCheck: {
          command: `pg_isready --username=${CI_DATABASE.user} --dbname=${CI_DATABASE.name}`,
          interval: "10s",
          timeout: "5s",
          retries: 10
        }
      }
    ],
    steps: []
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/database-runtime": "0.1.118",
        "pg": "^8.13.1"
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
        value: DIALECT_ID,
        reason: "Configure database client driver for runtime wiring.",
        category: "runtime-config",
        id: "database-client-postgres"
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
