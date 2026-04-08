export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/assistant",
  version: "0.1.0",
  kind: "runtime",
  description: "App-local generated assistant runtime.",
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
          subpath: "./server/actionIds",
          summary: "Generated assistant action identifiers."
        },
        {
          subpath: "./client",
          summary: "Generated assistant client wrappers."
        },
        {
          subpath: "./shared",
          summary: "Generated assistant runtime configuration."
        }
      ],
      containerTokens: {
        server: [
          "assistant.config.repository",
          "assistant.conversation.repository",
          "assistant.message.repository",
          "assistant.ai.client",
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
      runtime: {},
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: []
  }
});
