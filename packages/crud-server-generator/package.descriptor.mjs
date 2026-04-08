export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/crud-server-generator",
  version: "0.1.36",
  kind: "generator",
  description: "CRUD server generator with routes, actions, and persistence scaffolding.",
  options: {
    namespace: {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "CRUD namespace",
      promptHint: "Required slug (example: customers, appointments, vendors)."
    },
    surface: {
      required: true,
      inputType: "text",
      promptLabel: "Target surface",
      promptHint: "Must match an enabled surface id."
    },
    "ownership-filter": {
      required: true,
      inputType: "text",
      defaultValue: "auto",
      promptLabel: "Ownership filter",
      promptHint: "auto | public | user | workspace | workspace_user"
    },
    "directory-prefix": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Route path prefix",
      promptHint: "Optional subpath prepended to the CRUD route path (example: crm or ops/team-a)."
    },
    "table-name": {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Table name",
      promptHint: "Required existing MySQL table to introspect for CRUD schema generation."
    },
    "id-column": {
      required: false,
      inputType: "text",
      defaultValue: "id",
      promptLabel: "Id column",
      promptHint: "Primary key column used by CRUD endpoints (default: id)."
    }
  },
  optionPolicies: {
    surfaceVisibility: {
      visibilityOption: "ownership-filter"
    }
  },
  dependsOn: [
    "@jskit-ai/auth-core",
    "@jskit-ai/crud-core",
    "@jskit-ai/database-runtime",
    "@jskit-ai/http-runtime",
    "@jskit-ai/realtime",
    "@jskit-ai/users-core"
  ],
  capabilities: {
    provides: ["crud"],
    requires: [
      "runtime.actions",
      "runtime.database",
      "auth.policy",
      "users.core"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/CrudProvider.js",
          export: "CrudProvider"
        }
      ]
    }
  },
  metadata: {
    generatorPrimarySubcommand: "scaffold",
    generatorSubcommands: {
      "scaffold": {
        description: "Scaffold a CRUD resource package for a table (same behavior as running generate with no subcommand).",
        optionNames: [
          "namespace",
          "surface",
          "ownership-filter",
          "table-name",
          "id-column",
          "directory-prefix"
        ]
      },
      "scaffold-field": {
        entrypoint: "src/server/subcommands/addField.js",
        export: "runGeneratorSubcommand",
        description: "Patch one writable field into an existing generated CRUD resource module.",
        positionalArgs: [
          {
            name: "<fieldKey>",
            required: true,
            description: "Resource field key (camelCase) resolved from the DB snapshot."
          },
          {
            name: "<targetFile>",
            required: true,
            description: "Path to the generated CRUD resource file relative to app root."
          }
        ],
        optionNames: [
          "table-name",
          "id-column"
        ]
      }
    },
    apiSummary: {
      surfaces: [
        {
          subpath: "./server",
          summary: "Scaffold package runtime provider (no-op) plus reference CRUD server modules."
        },
        {
          subpath: "./shared",
          summary: "Exports shared CRUD resource and module config helpers."
        }
      ],
      containerTokens: {
        server: []
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/auth-core": "0.1.27",
        "@jskit-ai/crud-core": "0.1.36",
        "@jskit-ai/database-runtime": "0.1.28",
        "@jskit-ai/http-runtime": "0.1.27",
        "@jskit-ai/kernel": "0.1.28",
        "@jskit-ai/realtime": "0.1.27",
        "@jskit-ai/users-core": "0.1.38",
        "@local/${option:namespace|kebab}": "file:packages/${option:namespace|kebab}",
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
        from: "templates/migrations/crud_initial.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install CRUD schema migration.",
        category: "crud",
        id: "crud-initial-schema-${option:namespace|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/package.json",
        to: "packages/${option:namespace|kebab}/package.json",
        reason: "Install app-local CRUD package manifest.",
        category: "crud",
        id: "crud-local-package-json-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/package.descriptor.mjs",
        to: "packages/${option:namespace|kebab}/package.descriptor.mjs",
        reason: "Install app-local CRUD package descriptor.",
        category: "crud",
        id: "crud-local-package-descriptor-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/server/CrudProvider.js",
        to: "packages/${option:namespace|kebab}/src/server/${option:namespace|pascal}Provider.js",
        reason: "Install app-local CRUD server provider.",
        category: "crud",
        id: "crud-local-package-server-provider-${option:namespace|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/server/actions.js",
        to: "packages/${option:namespace|kebab}/src/server/actions.js",
        reason: "Install app-local CRUD action definitions.",
        category: "crud",
        id: "crud-local-package-server-actions-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/server/actionIds.js",
        to: "packages/${option:namespace|kebab}/src/server/actionIds.js",
        reason: "Install app-local CRUD action IDs.",
        category: "crud",
        id: "crud-local-package-server-action-ids-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/server/registerRoutes.js",
        to: "packages/${option:namespace|kebab}/src/server/registerRoutes.js",
        reason: "Install app-local CRUD route registration.",
        category: "crud",
        id: "crud-local-package-server-routes-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/server/repository.js",
        to: "packages/${option:namespace|kebab}/src/server/repository.js",
        reason: "Install app-local CRUD repository.",
        category: "crud",
        id: "crud-local-package-server-repository-${option:namespace|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/server/service.js",
        to: "packages/${option:namespace|kebab}/src/server/service.js",
        reason: "Install app-local CRUD service.",
        category: "crud",
        id: "crud-local-package-server-service-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/shared/index.js",
        to: "packages/${option:namespace|kebab}/src/shared/index.js",
        reason: "Install app-local CRUD shared exports.",
        category: "crud",
        id: "crud-local-package-shared-index-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/shared/crudResource.js",
        to: "packages/${option:namespace|kebab}/src/shared/${option:namespace|singular|camel}Resource.js",
        reason: "Install app-local CRUD resource.",
        category: "crud",
        id: "crud-local-package-shared-resource-${option:namespace|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      }
    ],
    text: [
      {
        op: "append-text",
        file: "config/roles.js",
        position: "bottom",
        skipIfContains: "\"crud.${option:namespace|snake}.list\"",
        value:
          "\nroleCatalog.roles.member.permissions.push(\n  \"crud.${option:namespace|snake}.list\",\n  \"crud.${option:namespace|snake}.view\",\n  \"crud.${option:namespace|snake}.create\",\n  \"crud.${option:namespace|snake}.update\",\n  \"crud.${option:namespace|snake}.delete\"\n);\n",
        reason: "Grant generated CRUD action permissions to the default member role in the app-owned role catalog.",
        category: "crud",
        id: "crud-role-catalog-permissions-${option:namespace|snake}"
      }
    ]
  }
});
