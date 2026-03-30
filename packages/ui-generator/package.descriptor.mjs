export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/ui-generator",
  version: "0.1.3",
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
      element: {
        entrypoint: "src/server/subcommands/element.js",
        export: "runGeneratorSubcommand"
      },
      container: {
        entrypoint: "src/server/subcommands/container.js",
        export: "runGeneratorSubcommand"
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
        "@jskit-ai/users-web": "0.1.34"
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
          "\n// jskit:ui-generator.page.menu:${option:surface|lower}:${option:directory-prefix|path}:${option:name|path}\n{\n  addPlacement({\n    id: \"ui-generator.page.${option:name|kebab}.menu\",\n    host: \"__JSKIT_UI_MENU_PLACEMENT_HOST__\",\n    position: \"__JSKIT_UI_MENU_PLACEMENT_POSITION__\",\n    surfaces: [\"${option:surface|lower}\"],\n    order: 155,\n    componentToken: \"users.web.shell.surface-aware-menu-link-item\",\n    props: {\n      label: \"${option:name|trim}\",\n      surface: \"${option:surface|lower}\",\n      workspaceSuffix: \"/${option:directory-prefix|pathprefix}${option:name|path}\",\n      nonWorkspaceSuffix: \"/${option:directory-prefix|pathprefix}${option:name|path}\"\n    },\n    when: ({ auth }) => Boolean(auth?.authenticated)\n  });\n}\n",
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
