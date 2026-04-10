export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/crud-ui-generator",
  version: "0.1.14",
  kind: "generator",
  description: "Generate CRUD route trees from resource validators at an explicit src/pages target root.",
  options: {
    "target-root": {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Target route root",
      promptHint: "Explicit route root under src/pages/... (example: src/pages/admin/catalog/products)."
    },
    "resource-file": {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Resource file",
      promptHint: "Relative path from app root to the resource module."
    },
    operations: {
      required: false,
      inputType: "text",
      defaultValue: "list,view,new,edit",
      promptLabel: "Operations",
      promptHint: "Optional comma-separated values from: list, view, new, edit. Defaults to all four."
    },
    "display-fields": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Display fields",
      promptHint: "Optional comma-separated field keys to render (must exist in selected operation schemas)."
    },
    "id-param": {
      required: false,
      inputType: "text",
      defaultValue: "recordId",
      promptLabel: "Route id param",
      promptHint: "Route param used by view and edit pages (default: recordId)."
    },
    "link-placement": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Link placement",
      promptHint: "Optional host:position override for the generated list-page link placement."
    },
    namespace: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Namespace override",
      promptHint: "Optional CRUD namespace override when the resource export does not expose resource.resource."
    }
  },
  dependsOn: [],
  capabilities: {
    provides: ["ui-generator"],
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
    generatorPrimarySubcommand: "crud",
    generatorSubcommands: {
      crud: {
        description: "Create CRUD pages at an explicit route root under src/pages/.",
        positionalArgs: [
          {
            name: "target-root",
            required: true,
            description: "Route root directory relative to app root (example: src/pages/admin/products)."
          }
        ],
        optionNames: ["resource-file", "operations", "display-fields", "id-param", "link-placement", "namespace"],
        requiredOptionNames: ["resource-file"]
      },
      field: {
        entrypoint: "src/server/subcommands/addField.js",
        export: "runGeneratorSubcommand"
      }
    },
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/buildTemplateContext",
          summary: "Builds deterministic CRUD UI template context values from the explicit route root and resource validators."
        }
      ],
      containerTokens: {
        server: [],
        client: []
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/users-web": "0.1.46"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [
      {
        from: "templates/src/pages/admin/ui-generator/ListElement.vue",
        to: "${option:target-root|trim}/index.vue",
        reason: "Install generated list page.",
        category: "crud-ui-generator",
        id: "crud-ui-page-list-${option:target-root|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildUiTemplateContext"
        },
        when: {
          option: "operations",
          in: ["list"]
        }
      },
      {
        from: "templates/src/pages/admin/ui-generator/ViewElement.vue",
        to: "${option:target-root|trim}/[${option:id-param|trim}]/index.vue",
        reason: "Install generated view page.",
        category: "crud-ui-generator",
        id: "crud-ui-page-view-${option:target-root|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildUiTemplateContext"
        },
        when: {
          option: "operations",
          in: ["view"]
        }
      },
      {
        from: "templates/src/pages/admin/ui-generator/NewWrapperElement.vue",
        to: "${option:target-root|trim}/new.vue",
        reason: "Install generated new page.",
        category: "crud-ui-generator",
        id: "crud-ui-page-new-${option:target-root|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildUiTemplateContext"
        },
        when: {
          all: [
            {
              option: "operations",
              in: ["new"]
            },
            {
              option: "operations",
              in: ["edit"]
            }
          ]
        }
      },
      {
        from: "templates/src/pages/admin/ui-generator/EditWrapperElement.vue",
        to: "${option:target-root|trim}/[${option:id-param|trim}]/edit.vue",
        reason: "Install generated edit page.",
        category: "crud-ui-generator",
        id: "crud-ui-page-edit-${option:target-root|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildUiTemplateContext"
        },
        when: {
          all: [
            {
              option: "operations",
              in: ["new"]
            },
            {
              option: "operations",
              in: ["edit"]
            }
          ]
        }
      },
      {
        from: "templates/src/pages/admin/ui-generator/AddEditForm.vue",
        to: "${option:target-root|trim}/_components/CrudAddEditForm.vue",
        reason: "Install generated shared add/edit form component.",
        category: "crud-ui-generator",
        id: "crud-ui-page-add-edit-form-${option:target-root|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildUiTemplateContext"
        },
        when: {
          all: [
            {
              option: "operations",
              in: ["new"]
            },
            {
              option: "operations",
              in: ["edit"]
            }
          ]
        }
      },
      {
        from: "templates/src/pages/admin/ui-generator/AddEditFormFields.js",
        to: "${option:target-root|trim}/_components/CrudAddEditFormFields.js",
        reason: "Install generated shared add/edit form field definitions.",
        category: "crud-ui-generator",
        id: "crud-ui-page-add-edit-form-fields-${option:target-root|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildUiTemplateContext"
        },
        when: {
          all: [
            {
              option: "operations",
              in: ["new"]
            },
            {
              option: "operations",
              in: ["edit"]
            }
          ]
        }
      },
      {
        from: "templates/src/pages/admin/ui-generator/NewElement.vue",
        to: "${option:target-root|trim}/new.vue",
        reason: "Install generated new page.",
        category: "crud-ui-generator",
        id: "crud-ui-page-new-standalone-${option:target-root|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildUiTemplateContext"
        },
        when: {
          all: [
            {
              option: "operations",
              in: ["new"]
            },
            {
              option: "operations",
              notIn: ["edit"]
            }
          ]
        }
      },
      {
        from: "templates/src/pages/admin/ui-generator/EditElement.vue",
        to: "${option:target-root|trim}/[${option:id-param|trim}]/edit.vue",
        reason: "Install generated edit page.",
        category: "crud-ui-generator",
        id: "crud-ui-page-edit-standalone-${option:target-root|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildUiTemplateContext"
        },
        when: {
          all: [
            {
              option: "operations",
              in: ["edit"]
            },
            {
              option: "operations",
              notIn: ["new"]
            }
          ]
        }
      }
    ],
    text: [
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "__JSKIT_UI_MENU_MARKER__",
        value:
          "\n// __JSKIT_UI_MENU_MARKER__\n{\n  addPlacement({\n    id: \"__JSKIT_UI_MENU_PLACEMENT_ID__\",\n    host: \"__JSKIT_UI_MENU_PLACEMENT_HOST__\",\n    position: \"__JSKIT_UI_MENU_PLACEMENT_POSITION__\",\n    surfaces: [\"__JSKIT_UI_SURFACE_ID__\"],\n    order: 155,\n    componentToken: \"__JSKIT_UI_MENU_COMPONENT_TOKEN__\",\n    props: {\n      label: \"__JSKIT_UI_MENU_LABEL__\",\n      surface: \"__JSKIT_UI_SURFACE_ID__\",\n      workspaceSuffix: \"__JSKIT_UI_MENU_WORKSPACE_SUFFIX__\",\n      nonWorkspaceSuffix: \"__JSKIT_UI_MENU_NON_WORKSPACE_SUFFIX__\",\n__JSKIT_UI_MENU_TO_PROP_LINE__    },\n    when: ({ auth }) => Boolean(auth?.authenticated)\n  });\n}\n",
        reason: "Append generated CRUD list-page placement.",
        category: "crud-ui-generator",
        id: "crud-ui-placement-menu",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildUiTemplateContext"
        },
        when: {
          option: "operations",
          in: ["list"]
        }
      }
    ]
  }
});
