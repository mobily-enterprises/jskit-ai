export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/${option:namespace|kebab}",
  version: "0.1.0",
  description: "App-local CRUD package (${option:namespace|kebab}).",
  dependsOn: [
    "@jskit-ai/auth-core",
    "@jskit-ai/crud-core",
    "@jskit-ai/database-runtime",
    "@jskit-ai/http-runtime",
    "@jskit-ai/realtime",
    "@jskit-ai/shell-web",
    "@jskit-ai/users-core",
    "@jskit-ai/users-web"
  ],
  capabilities: {
    provides: [
      "crud.${option:namespace|kebab}"
    ],
    requires: [
      "runtime.actions",
      "runtime.database",
      "auth.policy",
      "users.core",
      "users.web",
      "runtime.web-placement",
      "runtime.realtime.client"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/${option:namespace|pascal}ServiceProvider.js",
          export: "${option:namespace|pascal}ServiceProvider"
        }
      ]
    },
    client: {
      providers: [
        {
          entrypoint: "src/client/providers/${option:namespace|pascal}ClientProvider.js",
          export: "${option:namespace|pascal}ClientProvider"
        }
      ]
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/diTokens",
          summary: "App-local CRUD public server DI token constants."
        },
        {
          subpath: "./server/actionIds",
          summary: "App-local CRUD public action identifiers."
        },
        {
          subpath: "./shared",
          summary: "App-local CRUD shared resource."
        },
        {
          subpath: "./client/*",
          summary: "App-local CRUD Vue client elements."
        }
      ],
      containerTokens: {
        server: [
          "repository.${option:namespace|snake}",
          "crud.${option:namespace|snake}"
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
