export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/ui-generator",
  version: "0.1.48",
  kind: "generator",
  description: "Create non-CRUD pages, reusable UI elements, and subpage hosts.",
  options: {
    name: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Display label",
      promptHint:
        "Display label used for generated page links and named UI elements. For page, if omitted, it is derived from the target file path."
    },
    surface: {
      required: false,
      inputType: "text",
      validationType: "enabled-surface-id",
      defaultFromConfig: "surfaceDefaultId",
      promptLabel: "Target surface",
      promptHint: "Optional. Used when JSKIT cannot infer the target surface from placement or app topology."
    },
    path: {
      required: false,
      inputType: "text",
      defaultValue: "src/components",
      promptLabel: "Component path",
      promptHint: "Component directory relative to app root (used by placed-element and add-subpages support scaffold)."
    },
    force: {
      required: false,
      inputType: "flag",
      defaultValue: "",
      promptLabel: "Force overwrite",
      promptHint: "Overwrite the generated file if it already exists."
    },
    placement: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Placement target",
      promptHint: "Optional target for placed-element placement (format: host:position, default: shell-layout:top-right)."
    },
    "link-placement": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Link placement",
      promptHint: "Optional target for the generated page link placement (format: host:position)."
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
        "Optional explicit props.to value for the generated page link placement (example: ./notes). If omitted for pages under a detected parent subpages target, it is inferred from the page path."
    },
    target: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Outlet target",
      promptHint: "Used by add-subpages and outlet. Must be a target in host:position format."
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
        requiresShellWeb: true,
        entrypoint: "src/server/subcommands/page.js",
        export: "runGeneratorSubcommand",
        description: "Create a route page at an explicit target file and add a link placement entry for it.",
        longDescription: [
          "This command always creates one route page file. By default, its page link is placed from the page path itself.",
          "If an ancestor page has already been enhanced with sub-pages, JSKIT treats that ancestor outlet as the real placement target. In that case the new page is linked into the nearest parent sub-pages outlet instead of the shell menu.",
          "That means the generated link normally becomes a tab or child-page link under that ancestor target, and `props.to` is inferred relative to that target. If the outlet page is `index.vue`, child pages belong under `index/...` so the router keeps the parent page visible while the child route renders underneath it."
        ],
        positionalArgs: [
          {
            name: "target-file",
            required: true,
            descriptionKey: "page-target-file"
          }
        ],
        optionNames: ["name", "link-placement", "link-component-token", "link-to", "force"],
        notes: [
          "If a nearest parent subpages target is found, placement, link component token, and props.to are inferred automatically.",
          "If the parent target page is index.vue, child pages belong under index/...",
          "If the target page file already exists, rerun with --force to overwrite it."
        ],
        examples: [
          {
            label: "Common usage",
            lines: [
              "npx jskit generate ui-generator page \\",
              "  admin/reports/index.vue \\",
              "  --name \"Reports\""
            ]
          },
          {
            label: "More advanced usage",
            lines: [
              "npx jskit generate ui-generator page \\",
              "  admin/customers/[customerId]/index/notes/index.vue \\",
              "  --name \"Notes\" \\",
              "  --force"
            ]
          }
        ]
      },
      "placed-element": {
        requiresShellWeb: true,
        entrypoint: "src/server/subcommands/element.js",
        export: "runGeneratorSubcommand",
        description: "Create a Vue component file under the chosen component directory (default: src/components) and add a placement entry that renders it.",
        optionNames: ["name", "surface", "path", "placement", "force"],
        requiredOptionNames: ["name"],
        notes: [
          "If --placement is omitted, the placed element is added at shell-layout:top-right.",
          "If the placement target belongs to a page-owned outlet, JSKIT infers the surface automatically.",
          "If the target is shared and the app has multiple enabled surfaces, pass --surface explicitly.",
          "If the component file already exists, rerun with --force to overwrite it."
        ],
        examples: [
          {
            label: "Common usage",
            lines: [
              "npx jskit generate ui-generator placed-element \\",
              "  --name \"Alerts Widget\""
            ]
          },
          {
            label: "More advanced usage",
            lines: [
              "npx jskit generate ui-generator placed-element \\",
              "  --name \"Ops Panel\" \\",
              "  --surface admin \\",
              "  --path src/widgets \\",
              "  --placement shell-layout:top-right \\",
              "  --force"
            ]
          }
        ]
      },
      "add-subpages": {
        requiresShellWeb: true,
        entrypoint: "src/server/subcommands/addSubpages.js",
        export: "runGeneratorSubcommand",
        description: "Upgrade an existing page into a routed subpage host with SectionContainerShell, ShellOutlet, and RouterView.",
        positionalArgs: [
          {
            name: "target-file",
            required: true,
            descriptionKey: "existing-page-target-file"
          }
        ],
        optionNames: ["target", "path", "title", "subtitle"],
        notes: [
          "Use this when the page should render shared content plus child routes below it.",
          "If the outlet page is index.vue, create child pages under index/..."
        ],
        examples: [
          {
            label: "Common usage",
            lines: [
              "npx jskit generate ui-generator add-subpages \\",
              "  admin/customers/[customerId]/index.vue \\",
              "  --title \"Customer\" \\",
              "  --subtitle \"View and manage this customer.\""
            ]
          },
          {
            label: "More advanced usage",
            lines: [
              "npx jskit generate ui-generator add-subpages \\",
              "  admin/contacts/[contactId]/index.vue \\",
              "  --target contact-view:summary-tabs \\",
              "  --path src/components/admin \\",
              "  --title \"Contact\" \\",
              "  --subtitle \"Manage contact modules.\""
            ]
          }
        ]
      },
      outlet: {
        requiresShellWeb: true,
        entrypoint: "src/server/subcommands/outlet.js",
        export: "runGeneratorSubcommand",
        description: "Inject a generic ShellOutlet block into an existing Vue page/component.",
        longDescription: [
          "A ShellOutlet creates a named placement target inside a Vue file. That target is what other parts of JSKIT render into later.",
          "After an outlet exists, `jskit list-placements` will discover it and show its `target`. That makes the outlet visible to humans and to generators that need a placement destination.",
          "Commands that create placed UI, such as `ui-generator placed-element`, and commands that add page links can then target that outlet by writing placement entries that point at the same target."
        ],
        positionalArgs: [
          {
            name: "target-file",
            required: true,
            descriptionKey: "existing-vue-sfc-target-file"
          }
        ],
        optionNames: ["target"],
        requiredOptionNames: ["target"],
        notes: [
          "Use --target host:position."
        ],
        examples: [
          {
            label: "Common usage",
            lines: [
              "npx jskit generate ui-generator outlet \\",
              "  src/components/ContactSummaryCard.vue \\",
              "  --target contact-view:sub-pages"
            ]
          },
          {
            label: "More advanced usage",
            lines: [
              "npx jskit generate ui-generator outlet \\",
              "  src/pages/admin/customers/[customerId]/index.vue \\",
              "  --target customer-view:summary-actions"
            ]
          }
        ]
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
        "@jskit-ai/users-web": "0.1.80"
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
