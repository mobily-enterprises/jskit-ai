export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/assistant",
  version: "0.1.38",
  kind: "generator",
  description: "Generate an app-local assistant runtime and settings integration from explicit surface choices.",
  options: {
    "runtime-surface": {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Runtime surface",
      promptHint: "Enabled surface id where the assistant page will run."
    },
    "settings-surface": {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Settings surface",
      promptHint: "Enabled surface id whose settings outlet will host the assistant settings form."
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
      promptHint: "Leave empty to keep assistant disabled until you add a key."
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
  dependsOn: [],
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
    generatorPrimarySubcommand: "install",
    generatorSubcommands: {
      install: {
        description: "Generate and install an app-local assistant runtime from explicit surface choices.",
        examples: [
          {
            label: "App runtime, console settings, global config",
            lines: [
              "npx jskit generate @jskit-ai/assistant install \\",
              "  --runtime-surface app \\",
              "  --settings-surface console \\",
              "  --config-scope global \\",
              "  --placement shell-layout:primary-menu \\",
              "  --menu-label Assistant \\",
              "  --ai-provider openai \\",
              "  --ai-api-key \"$OPENAI_API_KEY\" \\",
              "  --ai-base-url \"\" \\",
              "  --ai-timeout-ms 120000 \\",
              "  --run-npm-install"
            ]
          },
          {
            label: "App runtime, app settings, global config",
            lines: [
              "npx jskit generate @jskit-ai/assistant install \\",
              "  --runtime-surface app \\",
              "  --settings-surface app \\",
              "  --config-scope global \\",
              "  --placement shell-layout:primary-menu \\",
              "  --menu-label Assistant \\",
              "  --ai-provider openai \\",
              "  --ai-api-key \"$OPENAI_API_KEY\" \\",
              "  --ai-base-url \"\" \\",
              "  --ai-timeout-ms 120000 \\",
              "  --run-npm-install"
            ]
          },
          {
            label: "Workspace runtime, console settings, global config",
            lines: [
              "npx jskit generate @jskit-ai/assistant install \\",
              "  --runtime-surface admin \\",
              "  --settings-surface console \\",
              "  --config-scope global \\",
              "  --placement shell-layout:primary-menu \\",
              "  --menu-label Assistant \\",
              "  --ai-provider openai \\",
              "  --ai-api-key \"$OPENAI_API_KEY\" \\",
              "  --ai-base-url \"\" \\",
              "  --ai-timeout-ms 120000 \\",
              "  --run-npm-install"
            ]
          },
          {
            label: "Workspace runtime, workspace settings, workspace config",
            lines: [
              "npx jskit generate @jskit-ai/assistant install \\",
              "  --runtime-surface admin \\",
              "  --settings-surface admin \\",
              "  --config-scope workspace \\",
              "  --placement shell-layout:primary-menu \\",
              "  --menu-label Assistant \\",
              "  --ai-provider openai \\",
              "  --ai-api-key \"$OPENAI_API_KEY\" \\",
              "  --ai-base-url \"\" \\",
              "  --ai-timeout-ms 120000 \\",
              "  --run-npm-install"
            ]
          }
        ]
      }
    },
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
      runtime: {
        "@local/assistant": "file:packages/assistant",
        "@jskit-ai/assistant-core": "0.1.5",
        "@jskit-ai/database-runtime": "0.1.29",
        "@jskit-ai/http-runtime": "0.1.28",
        "@jskit-ai/kernel": "0.1.29",
        "@jskit-ai/shell-web": "0.1.28",
        "@jskit-ai/users-core": "0.1.39",
        "@jskit-ai/users-web": "0.1.44",
        "@tanstack/vue-query": "^5.90.5",
        "vuetify": "^4.0.0"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [
      {
        op: "install-migration",
        from: "templates/migrations/assistant_config_initial.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install assistant configuration schema migration.",
        category: "assistant",
        id: "assistant-config-initial-schema",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        op: "install-migration",
        from: "templates/migrations/assistant_transcripts_initial.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install assistant transcript schema migration.",
        category: "assistant",
        id: "assistant-transcripts-initial-schema",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/package.json",
        to: "packages/assistant/package.json",
        reason: "Install app-local assistant package manifest.",
        category: "assistant",
        id: "assistant-local-package-json"
      },
      {
        from: "templates/src/local-package/package.descriptor.mjs",
        to: "packages/assistant/package.descriptor.mjs",
        reason: "Install app-local assistant package descriptor.",
        category: "assistant",
        id: "assistant-local-package-descriptor"
      },
      {
        from: "templates/src/local-package/shared/assistantRuntimeConfig.js",
        to: "packages/assistant/src/shared/assistantRuntimeConfig.js",
        reason: "Install generated assistant runtime configuration.",
        category: "assistant",
        id: "assistant-local-runtime-config",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/shared/index.js",
        to: "packages/assistant/src/shared/index.js",
        reason: "Install generated assistant shared exports.",
        category: "assistant",
        id: "assistant-local-shared-index"
      },
      {
        from: "templates/src/local-package/client/index.js",
        to: "packages/assistant/src/client/index.js",
        reason: "Install generated assistant client exports.",
        category: "assistant",
        id: "assistant-local-client-index"
      },
      {
        from: "templates/src/local-package/client/components/AssistantSurfaceClientElement.vue",
        to: "packages/assistant/src/client/components/AssistantSurfaceClientElement.vue",
        reason: "Install generated assistant surface page component.",
        category: "assistant",
        id: "assistant-local-surface-client-element",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/client/components/AssistantSettingsClientElement.vue",
        to: "packages/assistant/src/client/components/AssistantSettingsClientElement.vue",
        reason: "Install generated assistant settings form component.",
        category: "assistant",
        id: "assistant-local-settings-client-element",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/client/composables/useAssistantRuntime.js",
        to: "packages/assistant/src/client/composables/useAssistantRuntime.js",
        reason: "Install generated assistant runtime composable.",
        category: "assistant",
        id: "assistant-local-runtime-composable",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/client/providers/AssistantClientProvider.js",
        to: "packages/assistant/src/client/providers/AssistantClientProvider.js",
        reason: "Install generated assistant client provider.",
        category: "assistant",
        id: "assistant-local-client-provider"
      },
      {
        from: "templates/src/local-package/server/AssistantProvider.js",
        to: "packages/assistant/src/server/AssistantProvider.js",
        reason: "Install generated assistant server provider.",
        category: "assistant",
        id: "assistant-local-server-provider",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/server/actionIds.js",
        to: "packages/assistant/src/server/actionIds.js",
        reason: "Install generated assistant action identifiers.",
        category: "assistant",
        id: "assistant-local-action-ids"
      },
      {
        from: "templates/src/local-package/server/actions.js",
        to: "packages/assistant/src/server/actions.js",
        reason: "Install generated assistant action definitions.",
        category: "assistant",
        id: "assistant-local-actions",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/server/registerRoutes.js",
        to: "packages/assistant/src/server/registerRoutes.js",
        reason: "Install generated assistant route registration.",
        category: "assistant",
        id: "assistant-local-register-routes",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/server/repositories/assistantConfigRepository.js",
        to: "packages/assistant/src/server/repositories/assistantConfigRepository.js",
        reason: "Install generated assistant config repository.",
        category: "assistant",
        id: "assistant-local-config-repository",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/server/repositories/conversationsRepository.js",
        to: "packages/assistant/src/server/repositories/conversationsRepository.js",
        reason: "Install generated assistant conversations repository.",
        category: "assistant",
        id: "assistant-local-conversations-repository",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/server/repositories/messagesRepository.js",
        to: "packages/assistant/src/server/repositories/messagesRepository.js",
        reason: "Install generated assistant messages repository.",
        category: "assistant",
        id: "assistant-local-messages-repository",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/server/services/assistantConfigService.js",
        to: "packages/assistant/src/server/services/assistantConfigService.js",
        reason: "Install generated assistant config service.",
        category: "assistant",
        id: "assistant-local-config-service",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/server/services/chatService.js",
        to: "packages/assistant/src/server/services/chatService.js",
        reason: "Install generated assistant chat service.",
        category: "assistant",
        id: "assistant-local-chat-service",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/local-package/server/services/transcriptService.js",
        to: "packages/assistant/src/server/services/transcriptService.js",
        reason: "Install generated assistant transcript service.",
        category: "assistant",
        id: "assistant-local-transcript-service",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/src/pages/assistant/index.vue",
        toSurface: "${option:runtime-surface|lower}",
        toSurfacePath: "assistant/index.vue",
        reason: "Install generated assistant runtime page.",
        category: "assistant",
        id: "assistant-page-runtime"
      }
    ],
    text: [
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"assistant.generated.menu\"",
        value:
          "\naddPlacement({\n  id: \"assistant.generated.menu\",\n  host: \"__ASSISTANT_MENU_PLACEMENT_HOST__\",\n  position: \"__ASSISTANT_MENU_PLACEMENT_POSITION__\",\n  surfaces: [\"${option:runtime-surface|lower}\"],\n  order: 310,\n  componentToken: \"__ASSISTANT_MENU_COMPONENT_TOKEN__\",\n  props: {\n    label: \"__ASSISTANT_MENU_LABEL__\",\n    surface: \"${option:runtime-surface|lower}\",\n    workspaceSuffix: \"__ASSISTANT_MENU_WORKSPACE_SUFFIX__\",\n    nonWorkspaceSuffix: \"__ASSISTANT_MENU_NON_WORKSPACE_SUFFIX__\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
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
        skipIfContains: "id: \"assistant.generated.settings.form\"",
        value:
          "\naddPlacement({\n  id: \"assistant.generated.settings.form\",\n  host: \"__ASSISTANT_SETTINGS_HOST__\",\n  position: \"forms\",\n  surfaces: [\"${option:settings-surface|lower}\"],\n  order: 250,\n  componentToken: \"assistant.web.settings.element\",\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append generated assistant settings form placement into app-owned settings placements.",
        category: "assistant",
        id: "assistant-settings-form-placement",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "AI_PROVIDER",
        value: "${option:ai-provider}",
        reason: "Configure assistant AI provider id.",
        category: "runtime-config",
        id: "assistant-ai-provider"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "AI_API_KEY",
        value: "${option:ai-api-key}",
        reason: "Configure assistant AI API key.",
        category: "runtime-config",
        id: "assistant-ai-api-key"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "AI_BASE_URL",
        value: "${option:ai-base-url}",
        reason: "Configure assistant AI base URL override.",
        category: "runtime-config",
        id: "assistant-ai-base-url"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "AI_TIMEOUT_MS",
        value: "${option:ai-timeout-ms}",
        reason: "Configure assistant AI timeout in milliseconds.",
        category: "runtime-config",
        id: "assistant-ai-timeout-ms"
      }
    ]
  }
});
