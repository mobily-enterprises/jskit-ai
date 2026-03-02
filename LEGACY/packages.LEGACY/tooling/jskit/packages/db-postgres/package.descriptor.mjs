export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/db-postgres",
  version: "0.1.0",
  description: "Postgres db-provider package for JSKIT database capability.",
  dependsOn: ["@jskit-ai/jskit-knex-postgres"],
  options: {
    "db-host": { required: true, values: [] },
    "db-port": { required: true, values: [] },
    "db-name": { required: true, values: [] },
    "db-user": { required: true, values: [] },
    "db-password": { required: true, values: [] }
  },
  capabilities: {
    provides: ["db-provider"],
    requires: []
  },
  mutations: {
    dependencies: {
      runtime: {
        knex: "https://codeload.github.com/knex/knex/tar.gz/c18fb1ba2dc3001ee0fb2a79c126a32e6cd831a5",
        pg: "^8.16.3"
      },
      dev: {}
    },
    packageJson: {
      scripts: {
        "db:migrate": "jskit-app-scripts db:migrate",
        "db:rollback": "jskit-app-scripts db:rollback",
        "db:seed": "jskit-app-scripts db:seed",
        "db:seed:users": "jskit-app-scripts db:seed:users",
        "db:seed:calculator": "jskit-app-scripts db:seed:calculator"
      }
    },
    text: [
      {
        file: "Procfile",
        op: "upsert-line",
        key: "release",
        line: "release: npm run db:migrate",
        reason: "Run database migrations during release phase.",
        category: "process-runtime",
        id: "db-release-migrate"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "DB_CLIENT",
        value: "pg",
        reason: "Set Knex SQL dialect for postgres provider.",
        category: "runtime-config",
        id: "db-client"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "DB_HOST",
        value: "${option:db-host}",
        reason: "Set database host for postgres connection.",
        category: "runtime-config",
        id: "db-host"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "DB_PORT",
        value: "${option:db-port}",
        reason: "Set database port for postgres connection.",
        category: "runtime-config",
        id: "db-port"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "DB_NAME",
        value: "${option:db-name}",
        reason: "Set default database name.",
        category: "runtime-config",
        id: "db-name"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "DB_USER",
        value: "${option:db-user}",
        reason: "Set database username for postgres connection.",
        category: "runtime-config",
        id: "db-user"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "DB_PASSWORD",
        value: "${option:db-password}",
        reason: "Set database password for postgres connection.",
        category: "runtime-config",
        id: "db-password"
      }
    ],
    files: [
      {
        from: "templates/knexfile.cjs",
        to: "knexfile.cjs",
        reason: "Provide Knex migration and seed configuration.",
        category: "database-bootstrap",
        id: "knexfile"
      },
      {
        from: "templates/migrations/20260101000000_create_placeholder_table.cjs",
        to: "migrations/20260101000000_create_placeholder_table.cjs",
        reason: "Add starter migration for install validation.",
        category: "database-bootstrap",
        id: "migration-placeholder"
      },
      {
        from: "templates/seeds/000_placeholder_seed.cjs",
        to: "seeds/000_placeholder_seed.cjs",
        reason: "Add starter seed for install validation.",
        category: "database-bootstrap",
        id: "seed-placeholder"
      }
    ]
  }
});
