export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/assistant-core",
  version: "0.1.16",
  kind: "runtime",
  description: "Reusable assistant client/server/shared primitives without surface-specific routes or settings ownership.",
  dependsOn: [
    "@jskit-ai/http-runtime",
    "@jskit-ai/users-core"
  ],
  capabilities: {
    provides: ["assistant.core"],
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
          subpath: "./client",
          summary: "Exports reusable assistant UI primitives, HTTP helpers, and client API builders."
        },
        {
          subpath: "./server",
          summary: "Exports reusable assistant AI/provider helpers, NDJSON streaming helpers, and repository persistence helpers."
        },
        {
          subpath: "./shared",
          summary: "Exports reusable assistant validators, path helpers, query keys, and stream/settings events."
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
        "@jskit-ai/http-runtime": "0.1.39",
        "@jskit-ai/kernel": "0.1.40",
        "@jskit-ai/users-core": "0.1.50",
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
    files: [],
    text: []
  }
});
