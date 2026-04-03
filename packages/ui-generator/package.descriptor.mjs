export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/ui-generator",
  version: "0.1.5",
  kind: "generator",
  description: "Generate app-local non-CRUD UI pages and outlet elements.",
  options: {
    name: {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Element name",
      promptHint: "Display name and route slug source (example: Reports Dashboard)."
    },
    surface: {
      required: true,
      inputType: "text",
      defaultFromConfig: "surfaceDefaultId",
      promptLabel: "Target surface",
      promptHint: "Defaults to config.public.surfaceDefaultId. Must match an enabled surface id."
    },
    path: {
      required: false,
      inputType: "text",
      defaultValue: "src/components",
      promptLabel: "Component path",
      promptHint: "Component directory relative to app root (used by element subcommand)."
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
      promptLabel: "Placement target",
      promptHint: "Optional host:position target (defaults to app ShellOutlet default target)."
    },
    "placement-component-token": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Placement component token",
      promptHint:
        "Optional component token override for generated menu placement (example: local.main.ui.tab-link-item)."
    },
    "placement-to": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Placement to",
      promptHint:
        "Optional explicit props.to value for generated menu placement (example: ./notes). If omitted and directory-prefix includes a nestedChildren route group, defaults to ./<page-slug>."
    },
    file: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Target Vue file",
      promptHint: "Vue SFC path relative to app root (used by outlet subcommand)."
    },
    host: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Outlet host",
      promptHint: "ShellOutlet host value to inject into target file."
    },
    position: {
      required: false,
      inputType: "text",
      defaultValue: "sub-pages",
      promptLabel: "Outlet position",
      promptHint: "ShellOutlet position value to inject into target file."
    },
    mode: {
      required: false,
      inputType: "text",
      defaultValue: "routed",
      promptLabel: "Outlet mode",
      promptHint: "routed | outlet-only (routed injects RouterView when missing)."
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
    generatorPrimarySubcommand: "page",
    generatorSubcommands: {
      page: {
        description: "Scaffold a non-CRUD page and add a menu placement entry.",
        optionNames: ["name", "surface", "directory-prefix", "placement", "placement-component-token", "placement-to"]
      },
      element: {
        entrypoint: "src/server/subcommands/element.js",
        export: "runGeneratorSubcommand",
        description: "Scaffold a reusable UI element component and register a placement.",
        optionNames: ["name", "surface", "path", "placement"]
      },
      container: {
        entrypoint: "src/server/subcommands/container.js",
        export: "runGeneratorSubcommand",
        description: "Scaffold a routed section container page with a tab outlet. Adds a menu entry only when --placement is passed.",
        optionNames: ["name", "surface", "directory-prefix", "path", "placement"]
      },
      outlet: {
        entrypoint: "src/server/subcommands/outlet.js",
        export: "runGeneratorSubcommand",
        description: "Inject a ShellOutlet block into an existing Vue page/component.",
        optionNames: ["file", "host", "position", "mode"],
        requiredOptionNames: ["file", "host"]
      }
    },
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/buildTemplateContext",
          summary: "Builds deterministic page menu placement template context values."
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
        "@jskit-ai/users-web": "0.1.36"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [
      {
        from: "templates/src/pages/admin/ui-generator/Page.vue",
        toSurface: "${option:surface|lower}",
        toSurfacePath: "${option:directory-prefix|pathprefix}${option:name|path}/index.vue",
        reason: "Install generated UI page scaffold.",
        category: "ui-generator",
        id: "ui-generator-page-${option:name|snake}"
      }
    ],
    text: [
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "jskit:ui-generator.page.menu:${option:surface|lower}:${option:directory-prefix|path}:${option:name|path}",
        value:
          "\n// jskit:ui-generator.page.menu:${option:surface|lower}:${option:directory-prefix|path}:${option:name|path}\n{\n  addPlacement({\n    id: \"ui-generator.page.${option:name|kebab}.menu\",\n    host: \"__JSKIT_UI_MENU_PLACEMENT_HOST__\",\n    position: \"__JSKIT_UI_MENU_PLACEMENT_POSITION__\",\n    surfaces: [\"${option:surface|lower}\"],\n    order: 155,\n    componentToken: \"__JSKIT_UI_MENU_COMPONENT_TOKEN__\",\n    props: {\n      label: \"${option:name|trim}\",\n      surface: \"${option:surface|lower}\",\n      workspaceSuffix: \"__JSKIT_UI_MENU_WORKSPACE_SUFFIX__\",\n      nonWorkspaceSuffix: \"__JSKIT_UI_MENU_NON_WORKSPACE_SUFFIX__\",\n__JSKIT_UI_MENU_TO_PROP_LINE__    },\n    when: ({ auth }) => Boolean(auth?.authenticated)\n  });\n}\n",
        reason: "Append generated UI page menu placement.",
        category: "ui-generator",
        id: "ui-generator-page-placement-menu-${option:name|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildUiPageTemplateContext"
        }
      }
    ]
  }
});
