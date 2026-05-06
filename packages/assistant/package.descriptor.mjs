export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/assistant",
  version: "0.1.70",
  kind: "generator",
  description: "Install assistant runtime/config for one surface and scaffold assistant pages at explicit target files.",
  options: {
    surface: {
      required: true,
      inputType: "text",
      validationType: "enabled-surface-id",
      defaultFromConfig: "surfaceDefaultId",
      promptLabel: "Assistant surface",
      promptHint: "Assistant runtime surface id. Used by setup, or selected assistant surface for settings-page.",
      helpHint: "For setup, this is the runtime surface receiving assistant wiring. For settings-page, this is the assistant runtime configured by that page."
    },
    "settings-surface": {
      required: true,
      inputType: "text",
      validationType: "enabled-surface-id",
      defaultValue: "",
      promptLabel: "Which enabled surface should host the assistant settings UI?",
      helpHint: "Surface that hosts the settings UI for the selected assistant runtime."
    },
    "config-scope": {
      required: true,
      inputType: "text",
      defaultValue: "global",
      promptLabel: "Config scope",
      promptHint: "global | workspace. Workspace scope requires both setup surfaces to requireWorkspace=true."
    },
    name: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Page label",
      promptHint: "Optional page link label override for page and settings-page.",
      helpLabel: "Display label"
    },
    force: {
      required: false,
      inputType: "flag",
      defaultValue: "",
      promptLabel: "Force overwrite",
      promptHint: "Overwrite the generated page file if it already exists."
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
      promptHint: "Optional component token override for the generated page link placement."
    },
    "link-to": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Link to",
      promptHint: "Optional explicit props.to value for the generated page link placement."
    },
    "ai-config-prefix": {
      required: false,
      inputType: "text",
      defaultFromOptionTemplate: "${option:surface|snake|upper}_ASSISTANT",
      promptLabel: "AI config prefix",
      promptHint: "Optional env/config prefix override. Defaults to <SURFACE>_ASSISTANT."
    },
    "ai-provider": {
      required: true,
      defaultValue: "openai",
      promptLabel: "AI provider",
      promptHint: "Supported values: openai | deepseek | anthropic."
    },
    "ai-api-key": {
      required: true,
      allowEmpty: true,
      defaultValue: "",
      promptLabel: "AI API key",
      promptHint: "Leave empty to keep the assistant disabled until you add a key."
    },
    "ai-base-url": {
      required: false,
      defaultValue: "",
      promptLabel: "AI base URL",
      promptHint: "Optional provider-compatible base URL override."
    },
    "ai-timeout-ms": {
      required: true,
      defaultValue: "120000",
      promptLabel: "AI timeout (ms)",
      promptHint: "Abort AI requests after this many milliseconds."
    }
  },
  dependsOn: ["@jskit-ai/assistant-runtime"],
  capabilities: {
    provides: ["assistant-generator"],
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
    generatorPrimarySubcommand: "setup",
    generatorSubcommands: {
      setup: {
        description: "Install assistant runtime/config for one target surface without creating pages.",
        optionNames: [
          "surface",
          "settings-surface",
          "config-scope",
          "ai-config-prefix",
          "ai-provider",
          "ai-api-key",
          "ai-base-url",
          "ai-timeout-ms"
        ],
        notes: [
          "setup installs runtime/config only. It does not create assistant pages.",
          "--surface selects the assistant runtime surface, and --settings-surface selects the surface that will host its settings UI."
        ],
        examples: [
          {
            label: "Common usage",
            lines: [
              "npx jskit generate assistant setup \\",
              "  --surface admin \\",
              "  --settings-surface admin \\",
              "  --config-scope workspace \\",
              "  --ai-api-key \"$OPENAI_API_KEY\""
            ]
          },
          {
            label: "More advanced usage",
            lines: [
              "npx jskit generate assistant setup \\",
              "  --surface console \\",
              "  --settings-surface console \\",
              "  --config-scope global \\",
              "  --ai-config-prefix CONSOLE_ASSISTANT \\",
              "  --ai-provider openai \\",
              "  --ai-api-key \"$OPENAI_API_KEY\" \\",
              "  --ai-base-url \"http://localhost:11434/v1\" \\",
              "  --ai-timeout-ms 60000"
            ]
          }
        ]
      },
      page: {
        requiresShellWeb: true,
        entrypoint: "src/server/subcommands/page.js",
        export: "runGeneratorSubcommand",
        description: "Create an assistant runtime page at an explicit target file relative to src/pages/.",
        positionalArgs: [
          {
            name: "target-file",
            required: true,
            descriptionKey: "page-target-file"
          }
        ],
        optionNames: ["name", "link-placement", "link-component-token", "link-to", "force"],
        notes: [
          "The target file decides where the page lives.",
          "Page-link placement follows the same inference rules as ui-generator page.",
          "If the target page file already exists, rerun with --force to overwrite it."
        ],
        examples: [
          {
            label: "Common usage",
            lines: [
              "npx jskit generate assistant page \\",
              "  admin/assistant/index.vue"
            ]
          },
          {
            label: "More advanced usage",
            lines: [
              "npx jskit generate assistant page \\",
              "  admin/ops/copilot/index.vue \\",
              "  --name \"Copilot\" \\",
              "  --link-placement shell-layout:top-right"
            ]
          }
        ]
      },
      "settings-page": {
        requiresShellWeb: true,
        entrypoint: "src/server/subcommands/settingsPage.js",
        export: "runGeneratorSubcommand",
        description: "Create an assistant settings page at an explicit target file relative to src/pages/.",
        positionalArgs: [
          {
            name: "target-file",
            required: true,
            descriptionKey: "page-target-file"
          }
        ],
        optionNames: ["surface", "name", "link-placement", "link-component-token", "link-to", "force"],
        requiredOptionNames: ["surface"],
        notes: [
          "The target file decides where the settings page lives.",
          "--surface selects the assistant runtime being configured. It does not place the file.",
          "If the target page file already exists, rerun with --force to overwrite it."
        ],
        examples: [
          {
            label: "Common usage",
            lines: [
              "npx jskit generate assistant settings-page \\",
              "  admin/settings/index/assistant/index.vue \\",
              "  --surface admin"
            ]
          },
          {
            label: "More advanced usage",
            lines: [
              "npx jskit generate assistant settings-page \\",
              "  admin/settings/index/app-assistant/index.vue \\",
              "  --surface app \\",
              "  --name \"App Assistant\""
            ]
          }
        ]
      }
    },
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/buildTemplateContext",
          summary: "Builds deterministic assistant setup template context values from app surface metadata."
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
      runtime: {},
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [],
    text: [
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.assistantSurfaces.${option:surface|lower} = {",
        value:
          "\nconfig.assistantSurfaces.${option:surface|lower} = {\n  settingsSurfaceId: \"__ASSISTANT_SETTINGS_SURFACE_ID__\",\n  configScope: \"__ASSISTANT_CONFIG_SCOPE__\"\n};\n",
        reason: "Register the assistant runtime surface in public app config.",
        category: "assistant",
        id: "assistant-public-surface-config",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        op: "append-text",
        file: "config/server.js",
        position: "bottom",
        skipIfContains: "config.assistantServer.${option:surface|lower} = {",
        value:
          "\nconfig.assistantServer.${option:surface|lower} = {\n  aiConfigPrefix: \"__ASSISTANT_AI_CONFIG_PREFIX__\"\n};\n",
        reason: "Register assistant server config for the selected runtime surface.",
        category: "assistant",
        id: "assistant-server-surface-config",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "${option:ai-config-prefix}_AI_PROVIDER",
        value: "${option:ai-provider}",
        reason: "Configure the assistant AI provider for the selected surface.",
        category: "runtime-config",
        id: "assistant-ai-provider"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "${option:ai-config-prefix}_AI_API_KEY",
        value: "${option:ai-api-key}",
        reason: "Configure the assistant AI API key for the selected surface.",
        category: "runtime-config",
        id: "assistant-ai-api-key"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "${option:ai-config-prefix}_AI_BASE_URL",
        value: "${option:ai-base-url}",
        reason: "Configure the optional assistant AI base URL override for the selected surface.",
        category: "runtime-config",
        id: "assistant-ai-base-url"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "${option:ai-config-prefix}_AI_TIMEOUT_MS",
        value: "${option:ai-timeout-ms}",
        reason: "Configure the assistant AI timeout for the selected surface.",
        category: "runtime-config",
        id: "assistant-ai-timeout-ms"
      }
    ]
  }
});
