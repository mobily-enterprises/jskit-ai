export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/users-core",
  version: "0.1.0",
  description: "Users/workspace domain runtime: profiles, tenancy/workspace logic, and settings actions.",
  dependsOn: [
    "@jskit-ai/database-runtime"
  ],
  capabilities: {
    provides: [
      "users.core"
    ],
    requires: [
      "runtime.actions",
      "runtime.database"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/providers/UsersCoreServiceProvider.js",
          export: "UsersCoreServiceProvider"
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
          summary: "Exports UsersCoreServiceProvider, users/workspace repositories/services, and workspace/settings action contributors."
        },
        {
          subpath: "./shared",
          summary: "Exports shared users/workspace role and settings defaults."
        },
        {
          subpath: "./client",
          summary: "Exports no runtime API today (reserved client entrypoint)."
        }
      ],
      containerTokens: {
        server: [
          "users.core",
          "users.workspace.service",
          "users.workspace.admin.service",
          "users.settings.service"
        ],
        client: []
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/database-runtime": "0.1.0",
        "@jskit-ai/kernel": "0.1.0"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [
      {
        op: "install-migration",
        from: "templates/migrations/users_core_initial.cjs",
        toDir: "migrations",
        slug: "users_core_initial",
        extension: ".cjs",
        reason: "Install users/workspace core schema migration.",
        category: "migration",
        id: "users-core-initial-schema"
      }
    ]
  }
});
