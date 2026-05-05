export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/assistant-runtime",
  version: "0.1.31",
  kind: "runtime",
  description: "Shared assistant runtime with per-surface assistant registration.",
  dependsOn: [
    "@jskit-ai/assistant-core",
    "@jskit-ai/database-runtime",
    "@jskit-ai/http-runtime",
    "@jskit-ai/shell-web",
    "@jskit-ai/users-core",
    "@jskit-ai/users-web"
  ],
  capabilities: {
    provides: ["assistant.runtime"],
    requires: [
      "runtime.actions",
      "runtime.database",
      "auth.policy",
      "runtime.http-client",
      "users.core",
      "users.web"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/AssistantProvider.js",
          export: "AssistantProvider"
        }
      ]
    },
    client: {
      providers: [
        {
          entrypoint: "src/client/providers/AssistantClientProvider.js",
          export: "AssistantClientProvider"
        }
      ]
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./client",
          summary: "Exports assistant runtime client elements and composables."
        },
        {
          subpath: "./shared",
          summary: "Exports assistant runtime shared config helpers."
        },
        {
          subpath: "./server/actionIds",
          summary: "Exports assistant runtime action identifiers."
        }
      ],
      containerTokens: {
        server: [
          "assistant.config.repository",
          "assistant.conversation.repository",
          "assistant.message.repository",
          "assistant.ai.client.factory",
          "assistant.service.tool-catalog"
        ],
        client: [
          "assistant.web.settings.element"
        ]
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/assistant-core": "0.1.36",
        "@jskit-ai/database-runtime": "0.1.60",
        "@jskit-ai/http-runtime": "0.1.59",
        "@jskit-ai/kernel": "0.1.60",
        "@jskit-ai/shell-web": "0.1.59",
        "@jskit-ai/users-core": "0.1.70",
        "@jskit-ai/users-web": "0.1.75",
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
        category: "assistant-runtime",
        id: "assistant-runtime-config-initial-schema"
      },
      {
        op: "install-migration",
        from: "templates/migrations/assistant_transcripts_initial.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install assistant transcript schema migration.",
        category: "assistant-runtime",
        id: "assistant-runtime-transcripts-initial-schema"
      }
    ],
    text: [
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.assistantSurfaces ||= {};",
        value: "\nconfig.assistantSurfaces ||= {};\n",
        reason: "Initialize the shared assistant surface registry in public app config.",
        category: "assistant-runtime",
        id: "assistant-runtime-public-surface-registry-init"
      },
      {
        op: "append-text",
        file: "config/server.js",
        position: "bottom",
        skipIfContains: "config.assistantServer ||= {};",
        value: "\nconfig.assistantServer ||= {};\n",
        reason: "Initialize the shared assistant server config registry.",
        category: "assistant-runtime",
        id: "assistant-runtime-server-surface-registry-init"
      }
    ]
  }
});
