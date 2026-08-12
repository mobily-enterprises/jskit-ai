export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/assistant-core",
  version: "0.1.124",
  kind: "runtime",
  description: "Reusable assistant client/server/shared primitives without surface-specific routes or settings ownership.",
  dependsOn: [
    "@jskit-ai/http-runtime",
    "@jskit-ai/resource-core",
    "@jskit-ai/resource-crud-core",
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
        "@jskit-ai/http-runtime": "0.1.146",
        "@jskit-ai/kernel": "0.1.147",
        "@jskit-ai/resource-core": "0.1.90",
        "@jskit-ai/resource-crud-core": "0.1.90",
        "@jskit-ai/users-core": "0.1.161",
        "dompurify": "^3.3.3",
        "json-rest-schema": "^1.0.17",
        "marked": "^17.0.4",
        "openai": "^6.22.0"
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
