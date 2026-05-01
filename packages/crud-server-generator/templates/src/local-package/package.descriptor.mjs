export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/${option:namespace|kebab}",
  version: "0.1.0",
  kind: "runtime",
  description: "App-local CRUD package (${option:namespace|kebab}).",
  dependsOn: [
    "@jskit-ai/auth-core",
    "@jskit-ai/crud-core",
    "@jskit-ai/database-runtime",
    "@jskit-ai/http-runtime",
    "@jskit-ai/json-rest-api-core",
    "@jskit-ai/realtime",
    "@jskit-ai/resource-crud-core",
  ],
  capabilities: {
    provides: [
      "crud.${option:namespace|kebab}"
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
          entrypoint: "src/server/${option:namespace|pascal}Provider.js",
          export: "${option:namespace|pascal}Provider"
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
          "repository.${option:namespace|snake}",
          "crud.${option:namespace|snake}"
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
