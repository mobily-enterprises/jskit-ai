export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/feature-server-generator",
  version: "0.1.1",
  kind: "generator",
  description: "Scaffold substantial non-CRUD server feature packages with provider, actions, service, and optional persistence seams.",
  options: {
    "feature-name": {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Feature name",
      promptHint: "Required feature slug (example: booking-engine, availability-engine, billing-engine)."
    },
    mode: {
      required: false,
      inputType: "text",
      defaultValue: "json-rest",
      validationType: "enum",
      allowedValues: ["json-rest", "orchestrator", "custom-knex"],
      promptLabel: "Scaffold mode",
      promptHint: "json-rest | orchestrator | custom-knex"
    },
    surface: {
      required: false,
      inputType: "text",
      validationType: "enabled-surface-id",
      promptLabel: "Target surface",
      promptHint: "Optional surface id for generated action and route metadata."
    },
    "route-prefix": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Route prefix",
      promptHint: "Optional relative API path (example: admin/booking-engine)."
    },
    force: {
      required: false,
      inputType: "flag",
      defaultValue: "",
      promptLabel: "Force overwrite",
      promptHint: "Overwrite generated scaffold files if the feature package directory already exists."
    }
  },
  dependsOn: [],
  capabilities: {
    provides: ["feature-server-generator"],
    requires: []
  },
  runtime: {
    server: {
      providers: []
    },
    client: {
      providers: []
    }
  },
  metadata: {
    generatorPrimarySubcommand: "scaffold",
    generatorSubcommands: {
      scaffold: {
        description: "Create a dedicated non-CRUD server feature package with provider, actions, service, and optional repository/routes.",
        longDescription: [
          "This is the standard JSKIT starting point for substantial non-CRUD server features such as engines, workflows, and policy services.",
          "The default mode is json-rest. Use orchestrator for non-persistent coordination packages, or custom-knex only when raw knex is an explicit exception."
        ],
        positionalArgs: [
          {
            name: "feature-name",
            required: true,
            description: "Feature slug used for the package path, provider name, inline action ids, and default container tokens."
          }
        ],
        optionNames: ["feature-name", "mode", "surface", "route-prefix", "force"],
        createTarget: {
          pathTemplate: "packages/${option:feature-name|kebab}",
          label: "package directory",
          allowExistingEmptyDirectory: false
        },
        notes: [
          "json-rest emits a repository that starts from internal json-rest-api seams.",
          "orchestrator omits repository.js entirely and keeps the service focused on coordination.",
          "custom-knex is the explicit weird/custom lane and emits a repository wired to jskit.database.knex.",
          "If --route-prefix is omitted, registerRoutes.js is not generated."
        ],
        examples: [
          {
            label: "Default persistent feature",
            lines: [
              "npx jskit generate feature-server-generator scaffold \\",
              "  booking-engine"
            ]
          },
          {
            label: "Non-persistent orchestrator",
            lines: [
              "npx jskit generate feature-server-generator scaffold \\",
              "  availability-engine \\",
              "  --mode orchestrator"
            ]
          },
          {
            label: "Another default persistent feature",
            lines: [
              "npx jskit generate feature-server-generator scaffold \\",
              "  billing-engine"
            ]
          },
          {
            label: "Rare explicit custom-knex feature",
            lines: [
              "npx jskit generate feature-server-generator scaffold \\",
              "  invoice-rollup \\",
              "  --mode custom-knex \\",
              "  --route-prefix admin/invoice-rollup \\",
              "  --surface admin"
            ]
          }
        ]
      }
    },
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/buildTemplateContext",
          summary: "Builds deterministic non-CRUD feature server scaffold template context values."
        }
      ],
      containerTokens: {
        server: [],
        client: []
      }
    },
    jskit: {
      ownershipGuidance: {
        title: "Standard non-CRUD server lane",
        summary: "Use this generator when a substantial server feature should become its own package instead of growing inside packages/main.",
        responsibilities: [
          "provider: wires DI, actions, repository, and optional routes",
          "service: owns orchestration and must not talk to persistence directly",
          "repository: owns persistence; default-lane persistent scaffolds start from internal json-rest-api",
          "packages/main: stays composition/glue only"
        ],
        examples: [
          "jskit generate feature-server-generator scaffold booking-engine",
          "jskit generate feature-server-generator scaffold availability-engine --mode orchestrator",
          "jskit generate feature-server-generator scaffold billing-engine"
        ]
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/database-runtime": "0.1.59",
        "@jskit-ai/database-runtime-mysql": "0.1.58",
        "@jskit-ai/json-rest-api-core": "0.1.4",
        "@jskit-ai/kernel": "0.1.59",
        "json-rest-schema": "1.x.x",
        "@local/${option:feature-name|kebab}": "file:packages/${option:feature-name|kebab}"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [
      {
        from: "templates/src/local-package/package.json",
        to: "packages/${option:feature-name|kebab}/package.json",
        reason: "Install app-local non-CRUD feature package manifest.",
        category: "feature-server-generator",
        id: "feature-server-package-json-${option:feature-name|snake}"
      },
      {
        from: "templates/src/local-package/package.descriptor.mjs",
        to: "packages/${option:feature-name|kebab}/package.descriptor.mjs",
        reason: "Install app-local non-CRUD feature package descriptor.",
        category: "feature-server-generator",
        id: "feature-server-package-descriptor-${option:feature-name|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/server/FeatureProvider.js",
        to: "packages/${option:feature-name|kebab}/src/server/${option:feature-name|pascal}Provider.js",
        reason: "Install app-local non-CRUD feature provider.",
        category: "feature-server-generator",
        id: "feature-server-provider-${option:feature-name|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/server/inputSchemas.js",
        to: "packages/${option:feature-name|kebab}/src/server/inputSchemas.js",
        reason: "Install generated feature action and route validators.",
        category: "feature-server-generator",
        id: "feature-server-input-schemas-${option:feature-name|snake}"
      },
      {
        from: "templates/src/local-package/server/actions.js",
        to: "packages/${option:feature-name|kebab}/src/server/actions.js",
        reason: "Install generated feature action definitions.",
        category: "feature-server-generator",
        id: "feature-server-actions-${option:feature-name|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/server/service.js",
        to: "packages/${option:feature-name|kebab}/src/server/service.js",
        reason: "Install generated feature service.",
        category: "feature-server-generator",
        id: "feature-server-service-${option:feature-name|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/server/registerRoutes.js",
        to: "packages/${option:feature-name|kebab}/src/server/registerRoutes.js",
        reason: "Install generated feature route registration.",
        category: "feature-server-generator",
        id: "feature-server-routes-${option:feature-name|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        },
        when: {
          option: "route-prefix",
          hasText: true
        }
      },
      {
        from: "templates/src/local-package/server/repositoryJsonRest.js",
        to: "packages/${option:feature-name|kebab}/src/server/repository.js",
        reason: "Install generated feature repository with internal json-rest-api seam.",
        category: "feature-server-generator",
        id: "feature-server-repository-json-rest-${option:feature-name|snake}",
        when: {
          option: "mode",
          equals: "json-rest"
        }
      },
      {
        from: "templates/src/local-package/server/repositoryCustomKnex.js",
        to: "packages/${option:feature-name|kebab}/src/server/repository.js",
        reason: "Install generated feature repository with explicit knex seam.",
        category: "feature-server-generator",
        id: "feature-server-repository-custom-knex-${option:feature-name|snake}",
        when: {
          option: "mode",
          equals: "custom-knex"
        }
      }
    ],
    text: []
  }
});
