export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/${option:namespace|kebab|default(crud)}",
  version: "0.1.0",
  description: "App-local CRUD package (${option:namespace|kebab|default(crud)}).",
  dependsOn: [
    "@jskit-ai/auth-core",
    "@jskit-ai/database-runtime",
    "@jskit-ai/http-runtime",
    "@jskit-ai/shell-web",
    "@jskit-ai/users-core",
    "@jskit-ai/users-web"
  ],
  capabilities: {
    provides: [
      "crud.${option:namespace|kebab|default(crud)}"
    ],
    requires: [
      "runtime.actions",
      "runtime.database",
      "auth.policy",
      "users.core",
      "users.web",
      "runtime.web-placement"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/CrudServiceProvider.js",
          export: "CrudServiceProvider"
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
          summary: "App-local CRUD server provider/actions/routes/service/repository."
        },
        {
          subpath: "./shared",
          summary: "App-local CRUD shared resource and module config."
        },
        {
          subpath: "./client/*",
          summary: "App-local CRUD Vue client elements."
        }
      ],
      containerTokens: {
        server: [
          "crud.${option:namespace|snake|default(crud)}.repository",
          "crud.${option:namespace|snake|default(crud)}.service"
        ],
        client: []
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
