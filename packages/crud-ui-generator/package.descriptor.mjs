export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/crud-ui-generator",
  version: "0.1.6",
  kind: "generator",
  description: "Generate app-local CRUD UI scaffolds from resource validators.",
  options: {
    namespace: {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "UI namespace",
      promptHint: "Required slug (example: contacts-alt, customers-ui, tickets-view)."
    },
    surface: {
      required: true,
      inputType: "text",
      promptLabel: "Target surface",
      promptHint: "Must match an enabled surface id."
    },
    "resource-file": {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Resource file",
      promptHint: "Relative path from app root to the resource module."
    },
    operations: {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Operations",
      promptHint: "Required comma-separated values from: list, view, new, edit."
    },
    "display-fields": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Display fields",
      promptHint: "Optional comma-separated field keys to render (must exist in selected operation schemas)."
    },
    "api-path": {
      required: false,
      inputType: "text",
      defaultFromOptionTemplate: "/${option:namespace|kebab}",
      promptLabel: "API path",
      promptHint: "Base API path without trailing id (defaults to /<namespace>, example: /contacts)."
    },
    "route-path": {
      required: false,
      inputType: "text",
      defaultFromOptionTemplate: "${option:namespace|kebab}",
      promptLabel: "Route path",
      promptHint: "List route path under the target surface (defaults to <namespace>, example: contacts)."
    },
    container: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Container host",
      promptHint:
        "Optional container host slug (example: practice). Routes are generated under this prefix and list menu placement defaults to <container>:sub-pages."
    },
    "id-param": {
      required: false,
      inputType: "text",
      defaultValue: "recordId",
      promptLabel: "Route id param",
      promptHint: "Route param used by view and edit pages (default: recordId)."
    },
    "directory-prefix": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Page directory prefix",
      promptHint: "Optional subpath under the selected surface pages root (example: crm or ops/team-a)."
    },
    placement: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Menu placement",
      promptHint: "Optional host:position target (defaults to ShellLayout default outlet)."
    },
    "placement-component-token": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Placement component token",
      promptHint:
        "Optional component token override for generated menu placement. Use local.main.ui.tab-link-item for routed tab links (auto-provisions src/components/TabLinkItem.vue + MainClientProvider registration)."
    },
    "placement-to": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Placement to",
      promptHint:
        "Optional explicit props.to value for generated menu placement (example: ./pets). Required when adding placement for dynamic directory-prefix/route-path values."
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
      field: {
        entrypoint: "src/server/subcommands/addField.js",
        export: "runGeneratorSubcommand"
      }
    },
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/buildTemplateContext",
          summary: "Builds deterministic template context values from selected resource operation validators."
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
        "@jskit-ai/users-web": "0.1.37"
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
        toSurface: "${option:surface|lower}",
        toSurfacePath: "${option:directory-prefix|pathprefix}${option:container|pathprefix}${option:route-path|path}/index.vue",
        reason: "Install generated list page.",
        category: "ui-generator",
        id: "ui-generator-page-list-${option:namespace|snake}",
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
        toSurface: "${option:surface|lower}",
        toSurfacePath:
          "${option:directory-prefix|pathprefix}${option:container|pathprefix}${option:route-path|path}/[${option:id-param|trim}]/index.vue",
        reason: "Install generated view page.",
        category: "ui-generator",
        id: "ui-generator-page-view-${option:namespace|snake}",
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
        from: "templates/src/pages/admin/ui-generator/NewElement.vue",
        toSurface: "${option:surface|lower}",
        toSurfacePath: "${option:directory-prefix|pathprefix}${option:container|pathprefix}${option:route-path|path}/new.vue",
        reason: "Install generated new page.",
        category: "ui-generator",
        id: "ui-generator-page-new-${option:namespace|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildUiTemplateContext"
        },
        when: {
          option: "operations",
          in: ["new"]
        }
      },
      {
        from: "templates/src/pages/admin/ui-generator/EditElement.vue",
        toSurface: "${option:surface|lower}",
        toSurfacePath:
          "${option:directory-prefix|pathprefix}${option:container|pathprefix}${option:route-path|path}/[${option:id-param|trim}]/edit.vue",
        reason: "Install generated edit page.",
        category: "ui-generator",
        id: "ui-generator-page-edit-${option:namespace|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildUiTemplateContext"
        },
        when: {
          option: "operations",
          in: ["edit"]
        }
      }
    ],
    text: [
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains:
          "jskit:ui-generator.menu:${option:namespace|kebab}:${option:directory-prefix|path}:${option:container|path}:${option:route-path|path}",
        value:
          "\n// jskit:ui-generator.menu:${option:namespace|kebab}:${option:directory-prefix|path}:${option:container|path}:${option:route-path|path}\n{\n  addPlacement({\n    id: \"ui-generator.${option:namespace|kebab}.menu\",\n    host: \"__JSKIT_UI_MENU_PLACEMENT_HOST__\",\n    position: \"__JSKIT_UI_MENU_PLACEMENT_POSITION__\",\n    surfaces: [\"${option:surface|lower}\"],\n    order: 155,\n    componentToken: \"__JSKIT_UI_MENU_COMPONENT_TOKEN__\",\n    props: {\n      label: \"${option:namespace|plural|pascal}\",\n      surface: \"${option:surface|lower}\",\n      workspaceSuffix: \"__JSKIT_UI_MENU_WORKSPACE_SUFFIX__\",\n      nonWorkspaceSuffix: \"__JSKIT_UI_MENU_NON_WORKSPACE_SUFFIX__\",\n__JSKIT_UI_MENU_TO_PROP_LINE__    },\n    when: ({ auth }) => Boolean(auth?.authenticated)\n  });\n}\n",
        reason: "Append generated UI menu placement.",
        category: "ui-generator",
        id: "ui-generator-placement-menu",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildUiTemplateContext"
        },
        when: {
          all: [
            {
              option: "operations",
              in: ["list"]
            },
            {
              any: [
                {
                  all: [
                    {
                      option: "route-path",
                      notContains: "["
                    },
                    {
                      option: "directory-prefix",
                      notContains: "["
                    }
                  ]
                },
                {
                  all: [
                    {
                      option: "placement",
                      contains: ":"
                    },
                    {
                      option: "placement-to",
                      notEquals: ""
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    ]
  }
});
