export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/db-mysql",
  version: "0.1.0",
  description: "MySQL db-provider package for JSKIT database capability.",
  dependsOn: [],
  capabilities: {
    provides: ["db-provider"],
    requires: []
  },
  mutations: {
    dependencies: {
      runtime: {
        knex: "https://codeload.github.com/knex/knex/tar.gz/c18fb1ba2dc3001ee0fb2a79c126a32e6cd831a5",
        mysql2: "^3.15.3"
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
    procfile: {
      release: "npm run db:migrate"
    },
    files: [
      {
        from: "templates/knexfile.cjs",
        to: "knexfile.cjs"
      },
      {
        from: "templates/migrations/20260101000000_create_placeholder_table.cjs",
        to: "migrations/20260101000000_create_placeholder_table.cjs"
      },
      {
        from: "templates/seeds/000_placeholder_seed.cjs",
        to: "seeds/000_placeholder_seed.cjs"
      }
    ]
  }
});
