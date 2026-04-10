export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/ui-generator",
  version: "0.1.14",
  kind: "generator",
  description: "Generate app-local non-CRUD UI pages, placed elements, and page subpage hosts.",
  options: {
    name: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Page label",
      promptHint: "Optional display label override. If omitted for page, it is derived from the target file path."
    },
    surface: {
      required: false,
      inputType: "text",
      defaultFromConfig: "surfaceDefaultId",
      promptLabel: "Target surface",
      promptHint: "Used by the element subcommand. Must match an enabled surface id."
    },
    path: {
      required: false,
      inputType: "text",
      defaultValue: "src/components",
      promptLabel: "Component path",
      promptHint: "Component directory relative to app root (used by element and add-subpages support scaffold)."
    },
    placement: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Placement target",
      promptHint: "Optional host:position target for element placement (defaults to app ShellOutlet default target)."
    },
    "link-placement": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Link placement",
      promptHint: "Optional host:position target for the generated page link placement."
    },
    "link-component-token": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Link component token",
      promptHint:
        "Optional component token override for the generated page link placement (example: local.main.ui.tab-link-item)."
    },
    "link-to": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Link to",
      promptHint:
        "Optional explicit props.to value for the generated page link placement (example: ./notes). If omitted for nestedChildren routes, defaults to ./<page-slug>."
    },
    target: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Outlet target",
      promptHint:
        "Optional override for add-subpages. Use host or host:position; if omitted, it is derived from the page path."
    },
    host: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Host",
      promptHint: "ShellOutlet host value for generic outlets."
    },
    position: {
      required: false,
      inputType: "text",
      defaultValue: "sub-pages",
      promptLabel: "Outlet position",
      promptHint: "ShellOutlet position value to inject into target file."
    },
    title: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Section title",
      promptHint: "Optional SectionContainerShell title override for add-subpages."
    },
    subtitle: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Section subtitle",
      promptHint: "Optional SectionContainerShell subtitle override for add-subpages."
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
        entrypoint: "src/server/subcommands/page.js",
        export: "runGeneratorSubcommand",
        description: "Create a route page at an explicit target file and add a link placement entry for it.",
        positionalArgs: [
          {
            name: "target-file",
            required: true,
            description: "Vue page file relative to app root. It must live under exactly one surface pagesRoot."
          }
        ],
        optionNames: ["name", "link-placement", "link-component-token", "link-to"]
      },
      element: {
        entrypoint: "src/server/subcommands/element.js",
        export: "runGeneratorSubcommand",
        description: "Scaffold a reusable UI element component and register a placement.",
        optionNames: ["name", "surface", "path", "placement"],
        requiredOptionNames: ["name", "surface"]
      },
      "add-subpages": {
        entrypoint: "src/server/subcommands/addSubpages.js",
        export: "runGeneratorSubcommand",
        description: "Upgrade an existing page into a routed subpage host with SectionContainerShell, ShellOutlet, and RouterView.",
        positionalArgs: [
          {
            name: "target-file",
            required: true,
            description: "Existing Vue page file relative to app root. It must live under exactly one surface pagesRoot."
          }
        ],
        optionNames: ["target", "path", "title", "subtitle"]
      },
      outlet: {
        entrypoint: "src/server/subcommands/outlet.js",
        export: "runGeneratorSubcommand",
        description: "Inject a generic ShellOutlet block into an existing Vue page/component.",
        positionalArgs: [
          {
            name: "target-file",
            required: true,
            description: "Existing Vue SFC path relative to app root."
          }
        ],
        optionNames: ["host", "position"],
        requiredOptionNames: ["host"]
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
        "@jskit-ai/users-web": "0.1.46"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [],
    text: []
  }
});
