export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/assistant",
  version: "0.1.40",
  kind: "generator",
  description: "Generate an assistant page and per-surface assistant config using the shared assistant runtime.",
  options: {
    surface: {
      required: true,
      inputType: "text",
      defaultFromConfig: "surfaceDefaultId",
      promptLabel: "Assistant surface",
      promptHint: "Enabled surface id where the assistant page will run."
    },
    "settings-surface": {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Settings surface",
      promptHint: "Enabled surface id whose settings pages will include the assistant settings section."
    },
    "settings-route-path": {
      required: false,
      inputType: "text",
      defaultValue: "assistant",
      promptLabel: "Settings route path",
      promptHint: "Route segment to use for the assistant settings section page."
    },
    "config-scope": {
      required: true,
      inputType: "text",
      defaultValue: "global",
      promptLabel: "Config scope",
      promptHint: "global | workspace. Workspace scope requires both selected surfaces to requireWorkspace=true."
    },
    placement: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Menu placement",
      promptHint: "Optional host:position target for the assistant page menu entry."
    },
    "placement-component-token": {
      required: false,
      inputType: "text",
      defaultValue: "users.web.shell.surface-aware-menu-link-item",
      promptLabel: "Placement component token",
      promptHint: "Menu placement component token for the assistant page entry."
    },
    "menu-label": {
      required: false,
      inputType: "text",
      defaultValue: "Assistant",
      promptLabel: "Menu label",
      promptHint: "Menu label for the assistant page entry."
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
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/buildTemplateContext",
          summary: "Builds deterministic assistant generator template context values from app surface metadata."
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
    files: [
      {
        from: "templates/src/pages/assistant/index.vue",
        toSurface: "${option:surface|lower}",
        toSurfacePath: "assistant/index.vue",
        reason: "Install generated assistant runtime page.",
        category: "assistant",
        id: "assistant-page-runtime",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/pages/settings/assistant/index.vue",
        toSurface: "${option:settings-surface|lower}",
        toSurfacePath: "settings/${option:settings-route-path|path}/index.vue",
        reason: "Install generated assistant settings section page.",
        category: "assistant",
        id: "assistant-page-settings-standard",
        when: {
          option: "settings-surface",
          notEquals: "admin"
        },
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/pages/settings/assistant/index.vue",
        toSurface: "${option:settings-surface|lower}",
        toSurfacePath: "workspace/settings/${option:settings-route-path|path}/index.vue",
        reason: "Install generated assistant settings section page.",
        category: "assistant",
        id: "assistant-page-settings-admin",
        when: {
          option: "settings-surface",
          equals: "admin"
        },
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      }
    ],
    text: [
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "assistant.generated.menu:${option:surface|lower}",
        value:
          "\n// assistant.generated.menu:${option:surface|lower}\naddPlacement({\n  id: \"assistant.generated.menu.${option:surface|kebab}\",\n  host: \"__ASSISTANT_MENU_PLACEMENT_HOST__\",\n  position: \"__ASSISTANT_MENU_PLACEMENT_POSITION__\",\n  surfaces: [\"${option:surface|lower}\"],\n  order: 310,\n  componentToken: \"__ASSISTANT_MENU_COMPONENT_TOKEN__\",\n  props: {\n    label: \"__ASSISTANT_MENU_LABEL__\",\n    surface: \"${option:surface|lower}\",\n    workspaceSuffix: \"__ASSISTANT_MENU_WORKSPACE_SUFFIX__\",\n    nonWorkspaceSuffix: \"__ASSISTANT_MENU_NON_WORKSPACE_SUFFIX__\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append generated assistant runtime menu placement into app-owned placement registry.",
        category: "assistant",
        id: "assistant-placement-menu",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "assistant.generated.settings.menu:${option:surface|lower}",
        value:
          "\n// assistant.generated.settings.menu:${option:surface|lower}\naddPlacement({\n  id: \"assistant.generated.settings.menu.${option:surface|kebab}\",\n  host: \"__ASSISTANT_SETTINGS_HOST__\",\n  position: \"primary-menu\",\n  surfaces: [\"${option:settings-surface|lower}\"],\n  order: 250,\n  componentToken: \"users.web.shell.surface-aware-menu-link-item\",\n  props: {\n    label: \"__ASSISTANT_SETTINGS_MENU_LABEL__\",\n    surface: \"${option:settings-surface|lower}\",\n    workspaceSuffix: \"__ASSISTANT_SETTINGS_MENU_WORKSPACE_SUFFIX__\",\n    nonWorkspaceSuffix: \"__ASSISTANT_SETTINGS_MENU_NON_WORKSPACE_SUFFIX__\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append generated assistant settings section menu placement into app-owned settings placements.",
        category: "assistant",
        id: "assistant-settings-menu-placement",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.assistantSurfaces.${option:surface|lower} = {",
        value:
          "\nconfig.assistantSurfaces.${option:surface|lower} = {\n  settingsSurfaceId: \"__ASSISTANT_SETTINGS_SURFACE_ID__\",\n  configScope: \"__ASSISTANT_CONFIG_SCOPE__\"\n};\n",
        reason: "Register the generated assistant surface in public app config.",
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
        reason: "Register generated assistant server config for the selected surface.",
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
