export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/assistant",
  version: "0.1.23",
  description: "Unified assistant module with streaming chat, transcript persistence, service-aware tool execution, and workspace UI.",
  options: {
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
    },
    surfaces: {
      required: true,
      inputType: "text",
      defaultValue: "admin",
      promptLabel: "Target workspace surfaces",
      promptHint: "Comma-separated workspace surface ids for assistant page + menu placement (for example: admin,app)."
    }
  },
  dependsOn: [
    "@jskit-ai/auth-core",
    "@jskit-ai/database-runtime",
    "@jskit-ai/http-runtime",
    "@jskit-ai/realtime",
    "@jskit-ai/users-core",
    "@jskit-ai/users-web"
  ],
  capabilities: {
    provides: ["assistant"],
    requires: [
      "runtime.actions",
      "runtime.database",
      "auth.policy",
      "users.core",
      "users.web",
      "runtime.realtime.client"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/AssistantServiceProvider.js",
          export: "AssistantServiceProvider"
        }
      ]
    },
    client: {
      providers: [
        {
          entrypoint: "src/client/providers/AssistantWebClientProvider.js",
          export: "AssistantWebClientProvider"
        }
      ]
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/AssistantServiceProvider",
          summary: "Exports assistant runtime provider."
        },
        {
          subpath: "./client",
          summary: "Exports assistant workspace element and composables."
        },
        {
          subpath: "./shared",
          summary: "Exports assistant API paths, query keys, stream events, and resource validators."
        }
      ],
      containerTokens: {
        server: [
          "assistant.chat.service",
          "assistant.settings.service",
          "assistant.transcript.service",
          "assistant.conversation.repository",
          "assistant.message.repository",
          "assistant.settings.repository"
        ],
        client: [
          "assistant.web.console-settings.element",
          "assistant.web.workspace-settings.element"
        ]
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/assistant": "0.1.23",
        "@jskit-ai/auth-core": "0.1.14",
        "@jskit-ai/database-runtime": "0.1.15",
        "@jskit-ai/http-runtime": "0.1.14",
        "@jskit-ai/kernel": "0.1.14",
        "@jskit-ai/realtime": "0.1.14",
        "@jskit-ai/users-core": "0.1.19",
        "@jskit-ai/users-web": "0.1.24",
        "@tanstack/vue-query": "^5.90.5",
        "dompurify": "^3.3.3",
        "marked": "^17.0.4",
        "openai": "^6.22.0",
        "typebox": "^1.0.81",
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
        from: "templates/migrations/assistant_transcripts_initial.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install assistant conversation/message schema migration.",
        category: "assistant",
        id: "assistant-transcripts-initial-schema"
      },
      {
        op: "install-migration",
        from: "templates/migrations/assistant_settings_initial.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install assistant settings schema migration.",
        category: "assistant",
        id: "assistant-settings-initial-schema"
      },
      {
        from: "templates/src/pages/admin/workspace/assistant/index.vue",
        toSurface: "${option:surfaces|lower}",
        toSurfacePath: "workspace/assistant/index.vue",
        reason: "Install assistant workspace page scaffold.",
        category: "assistant",
        id: "assistant-page-admin-workspace-assistant-index",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      }
    ],
    text: [
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"assistant.workspace.menu\"",
        value:
          "\n(() => {\n  const assistantWorkspaceSurfaceIds = \"${option:surfaces|lower}\"\n    .split(\",\")\n    .map((entry) => String(entry || \"\").trim().toLowerCase())\n    .filter(Boolean);\n\n  addPlacement({\n    id: \"assistant.workspace.menu\",\n    host: \"shell-layout\",\n    position: \"primary-menu\",\n    surfaces: assistantWorkspaceSurfaceIds.length > 0 ? assistantWorkspaceSurfaceIds : [\"*\"],\n    order: 310,\n    componentToken: \"users.web.shell.surface-aware-menu-link-item\",\n    props: {\n      label: \"Assistant\",\n      workspaceSuffix: \"/workspace/assistant\",\n      nonWorkspaceSuffix: \"/workspace/assistant\"\n    },\n    when: ({ auth }) => Boolean(auth?.authenticated)\n  });\n})();\n",
        reason: "Append assistant menu placement into app-owned placement registry.",
        category: "assistant",
        id: "assistant-placement-menu",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"assistant.workspace.settings.form\"",
        value:
          "\naddPlacement({\n  id: \"assistant.workspace.settings.form\",\n  host: \"workspace-settings\",\n  position: \"forms\",\n  surfaces: [\"*\"],\n  order: 250,\n  componentToken: \"assistant.web.workspace-settings.element\"\n});\n",
        reason: "Append assistant workspace settings form into app-owned settings placements.",
        category: "assistant",
        id: "assistant-workspace-settings-form-placement",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"assistant.console.settings.form\"",
        value:
          "\naddPlacement({\n  id: \"assistant.console.settings.form\",\n  host: \"console-settings\",\n  position: \"forms\",\n  surfaces: [\"*\"],\n  order: 250,\n  componentToken: \"assistant.web.console-settings.element\",\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append assistant console settings form into app-owned settings placements.",
        category: "assistant",
        id: "assistant-console-settings-form-placement"
      },
      {
        op: "append-text",
        file: "packages/main/src/shared/resources/consoleSettingsFields.js",
        position: "top",
        skipIfContains: "import { Type } from \"typebox\";",
        value: "import { Type } from \"typebox\";\n",
        reason: "Ensure app-owned console settings field registry has TypeBox import for assistant fields.",
        category: "assistant",
        id: "assistant-console-settings-fields-import-typebox"
      },
      {
        op: "append-text",
        file: "packages/main/src/shared/resources/consoleSettingsFields.js",
        position: "bottom",
        skipIfContains: "key: \"workspaceSurfacePrompt\"",
        value:
          "\ndefineField({\n  key: \"workspaceSurfacePrompt\",\n  dbColumn: \"assistant_workspace_surface_prompt\",\n  required: true,\n  inputSchema: Type.String({\n    maxLength: 12000,\n    messages: {\n      maxLength: \"Workspace surface system prompt must be at most 12000 characters.\",\n      default: \"Workspace surface system prompt must be valid text.\"\n    }\n  }),\n  outputSchema: Type.String({ maxLength: 12000 }),\n  normalizeInput: (value) => String(value || \"\"),\n  normalizeOutput: (value) => String(value || \"\"),\n  resolveDefault: () => \"\"\n});\n",
        reason: "Append assistant console settings field into app-owned console settings field registry.",
        category: "assistant",
        id: "assistant-console-settings-field-definition"
      },
      {
        op: "append-text",
        file: "packages/main/src/shared/resources/workspaceSettingsFields.js",
        position: "bottom",
        skipIfContains: "key: \"appSurfacePrompt\"",
        value:
          "\ndefineField({\n  key: \"appSurfacePrompt\",\n  dbColumn: \"assistant_app_surface_prompt\",\n  required: true,\n  inputSchema: Type.String({\n    maxLength: 12000,\n    messages: {\n      maxLength: \"App surface system prompt must be at most 12000 characters.\",\n      default: \"App surface system prompt must be valid text.\"\n    }\n  }),\n  outputSchema: Type.String({ maxLength: 12000 }),\n  normalizeInput: (value) => String(value || \"\"),\n  normalizeOutput: (value) => String(value || \"\"),\n  resolveDefault: () => \"\"\n});\n",
        reason: "Append assistant workspace settings field into app-owned workspace settings field registry.",
        category: "assistant",
        id: "assistant-workspace-settings-field-definition",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
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
        reason: "Configure assistant provider API key.",
        category: "runtime-config",
        id: "assistant-ai-api-key"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "AI_BASE_URL",
        value: "${option:ai-base-url}",
        reason: "Configure optional assistant provider base URL.",
        category: "runtime-config",
        id: "assistant-ai-base-url"
      },
      {
        file: ".env",
        op: "upsert-env",
        key: "AI_TIMEOUT_MS",
        value: "${option:ai-timeout-ms}",
        reason: "Configure assistant provider timeout.",
        category: "runtime-config",
        id: "assistant-ai-timeout-ms"
      }
    ]
  }
});
