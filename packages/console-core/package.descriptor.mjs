export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/console-core",
  version: "0.1.17",
  kind: "runtime",
  description: "Console runtime: console settings schema, bootstrap flags, actions, and HTTP routes.",
  dependsOn: [
    "@jskit-ai/database-runtime",
    "@jskit-ai/http-runtime",
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
          summary: "Exports shared console settings resource and field registration helpers."
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
        "@jskit-ai/database-runtime": "0.1.54",
        "@jskit-ai/http-runtime": "0.1.53",
        "@jskit-ai/kernel": "0.1.54",
        "@jskit-ai/users-core": "0.1.64",
        "typebox": "^1.0.81"
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
      },
      {
        from: "templates/packages/main/src/shared/resources/consoleSettingsFields.js",
        to: "packages/main/src/shared/resources/consoleSettingsFields.js",
        preserveOnRemove: true,
        reason: "Install app-owned console settings field definitions.",
        category: "console-core",
        id: "console-core-app-owned-console-settings-fields"
      }
    ],
    text: [
      {
        op: "append-text",
        file: "packages/main/src/shared/index.js",
        position: "top",
        skipIfContains: "import \"./resources/consoleSettingsFields.js\";",
        value: "import \"./resources/consoleSettingsFields.js\";\n",
        reason: "Load app-owned console settings field definitions inside the main shared module.",
        category: "console-core",
        id: "console-core-main-shared-console-settings-field-import"
      }
    ]
  }
});
