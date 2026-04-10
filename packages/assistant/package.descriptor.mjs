export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/assistant",
  version: "0.1.40",
  kind: "generator",
  description: "Install assistant runtime/config for one surface and scaffold assistant pages at explicit target files.",
  options: {
    surface: {
      required: true,
      inputType: "text",
      defaultFromConfig: "surfaceDefaultId",
      promptLabel: "Assistant surface",
      promptHint: "Runtime surface id for setup, or target assistant surface for settings-page."
    },
    "settings-surface": {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Settings surface",
      promptHint: "Enabled settings host surface id used by assistant setup."
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
      promptHint: "Optional page link label override for page and settings-page."
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
      defaultValue: "",
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
      required: true,
      allowEmpty: true,
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
        ]
      },
      page: {
        entrypoint: "src/server/subcommands/page.js",
        export: "runGeneratorSubcommand",
        description: "Create an assistant runtime page at an explicit target file under src/pages/.",
        positionalArgs: [
          {
            name: "target-file",
            required: true,
            description: "Vue page file relative to app root. It must live under exactly one surface pagesRoot."
          }
        ],
        optionNames: ["name", "link-placement", "link-component-token", "link-to"]
      },
      "settings-page": {
        entrypoint: "src/server/subcommands/settingsPage.js",
        export: "runGeneratorSubcommand",
        description: "Create an assistant settings page at an explicit target file under src/pages/.",
        positionalArgs: [
          {
            name: "target-file",
            required: true,
            description: "Vue page file relative to app root. It must live under exactly one surface pagesRoot."
          }
        ],
        optionNames: ["surface", "name", "link-placement", "link-component-token", "link-to"],
        requiredOptionNames: ["surface"]
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
        op: "append-text",
        file: ".env",
        position: "bottom",
        skipIfContains: "__ASSISTANT_AI_CONFIG_PREFIX___AI_PROVIDER=",
        value:
          "\n__ASSISTANT_AI_CONFIG_PREFIX___AI_PROVIDER=${option:ai-provider}\n__ASSISTANT_AI_CONFIG_PREFIX___AI_API_KEY=${option:ai-api-key}\n__ASSISTANT_AI_CONFIG_PREFIX___AI_BASE_URL=${option:ai-base-url}\n__ASSISTANT_AI_CONFIG_PREFIX___AI_TIMEOUT_MS=${option:ai-timeout-ms}\n",
        reason: "Append assistant AI env defaults for the generated surface prefix.",
        category: "runtime-config",
        id: "assistant-ai-prefixed-env",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      }
    ]
  }
});
