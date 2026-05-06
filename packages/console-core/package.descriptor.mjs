export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/console-core",
  version: "0.1.24",
  kind: "runtime",
  description: "Console runtime: console settings schema, bootstrap flags, actions, and HTTP routes.",
  dependsOn: [
    "@jskit-ai/auth-core",
    "@jskit-ai/database-runtime",
    "@jskit-ai/http-runtime",
    "@jskit-ai/resource-crud-core",
    "@jskit-ai/users-core"
  ],
  capabilities: {
    provides: [
      "console.core",
      "console.server-routes"
    ],
    requires: [
      "runtime.actions",
      "runtime.database",
      "users.core"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/ConsoleCoreServiceProvider.js",
          export: "ConsoleCoreServiceProvider"
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
          summary: "Exports ConsoleCoreServiceProvider plus console settings services, routes, and action definitions."
        },
        {
          subpath: "./shared",
          summary: "Exports the shared console settings resource contract."
        },
        {
          subpath: "./client",
          summary: "Exports no runtime API today (reserved client entrypoint)."
        }
      ],
      containerTokens: {
        server: [],
        client: []
      }
    },
    server: {
      routes: [
        {
          method: "GET",
          path: "/api/console/settings",
          summary: "Get console settings."
        },
        {
          method: "PATCH",
          path: "/api/console/settings",
          summary: "Update console settings."
        }
      ]
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/auth-core": "0.1.60",
        "@jskit-ai/database-runtime": "0.1.61",
        "@jskit-ai/http-runtime": "0.1.60",
        "@jskit-ai/kernel": "0.1.61",
        "@jskit-ai/resource-crud-core": "0.1.6",
        "@jskit-ai/users-core": "0.1.71"
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
        from: "templates/migrations/console_core_generic_initial.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install console settings schema migration.",
        category: "migration",
        id: "console-core-generic-initial-schema"
      }
    ],
    text: [
    ]
  }
});
