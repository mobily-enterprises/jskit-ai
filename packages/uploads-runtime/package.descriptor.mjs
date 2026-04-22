export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/uploads-runtime",
  version: "0.1.30",
  kind: "runtime",
  description: "Reusable upload runtime primitives for multipart parsing, policy validation, and blob storage.",
  dependsOn: [
    "@jskit-ai/kernel"
  ],
  capabilities: {
    provides: [
      "runtime.uploads"
    ],
    requires: []
  },
  runtime: {
    server: {
      providerEntrypoint: "src/server/providers/UploadsRuntimeServiceProvider.js",
      providers: [
        {
          entrypoint: "src/server/providers/UploadsRuntimeServiceProvider.js",
          export: "UploadsRuntimeServiceProvider"
        }
      ]
    },
    client: {
      providers: []
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/providers/UploadsRuntimeServiceProvider",
          summary: "Exports uploads runtime server provider."
        },
        {
          subpath: "./server/multipart/registerMultipartSupport",
          summary: "Exports Fastify multipart registration helper."
        },
        {
          subpath: "./server/multipart/readSingleMultipartFile",
          summary: "Exports a convenience helper for single-file multipart uploads."
        },
        {
          subpath: "./server/policy/uploadPolicy",
          summary: "Exports upload policy normalization and stream validation helpers."
        },
        {
          subpath: "./server/storage/createUploadStorageService",
          summary: "Exports raw upload storage helpers backed by jskit.storage."
        },
        {
          subpath: "./shared",
          summary: "Exports shared upload policy defaults and normalization helpers."
        },
        {
          subpath: "./client",
          summary: "Exports no client runtime API today (reserved client entrypoint)."
        }
      ],
      containerTokens: {
        server: [
          "runtime.uploads"
        ],
        client: []
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@fastify/multipart": "^9.4.0",
        "@jskit-ai/kernel": "0.1.52"
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
