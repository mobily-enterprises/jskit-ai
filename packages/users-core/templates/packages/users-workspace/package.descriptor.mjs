export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/users",
  version: "0.1.0",
  kind: "runtime",
  description: "App-local CRUD package (users).",
  dependsOn: [
    "@jskit-ai/auth-core",
    "@jskit-ai/crud-core",
    "@jskit-ai/database-runtime",
    "@jskit-ai/http-runtime",
    "@jskit-ai/json-rest-api-core",
    "@jskit-ai/users-core",
    "@jskit-ai/workspaces-core"
  ],
  capabilities: {
    provides: [
      "crud.users"
    ],
    requires: [
      "runtime.actions",
      "runtime.database",
      "auth.policy",
      "json-rest-api.core"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/UsersProvider.js",
          export: "UsersProvider"
        }
      ]
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./shared",
          summary: "App-local CRUD shared resource."
        }
      ],
      containerTokens: {
        server: [
          "repository.users",
          "crud.users"
        ]
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: []
  }
});
