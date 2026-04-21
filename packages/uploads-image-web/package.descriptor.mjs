export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/uploads-image-web",
  version: "0.1.26",
  kind: "runtime",
  description: "Reusable client-side image upload runtime with pre-upload image editing.",
  dependsOn: [
    "@jskit-ai/uploads-runtime"
  ],
  capabilities: {
    provides: [
      "runtime.uploads.image-web"
    ],
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
    client: {
      optimizeDeps: {
        include: [
          "@uppy/core",
          "@uppy/dashboard",
          "@uppy/image-editor",
          "@uppy/compressor",
          "@uppy/xhr-upload"
        ]
      }
    },
    apiSummary: {
      surfaces: [
        {
          subpath: "./client",
          summary: "Exports reusable image upload client runtime helpers."
        },
        {
          subpath: "./client/composables/createImageUploadRuntime",
          summary: "Exports the reusable image upload runtime factory."
        },
        {
          subpath: "./client/composables/createManagedImageAssetRuntime",
          summary: "Exports the managed image asset runtime factory for upload and optional delete flows."
        },
        {
          subpath: "./client/styles",
          summary: "Exports Uppy CSS side effects for image upload UIs."
        },
        {
          subpath: "./shared",
          summary: "Exports shared image upload defaults."
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
        "@jskit-ai/uploads-runtime": "0.1.26",
        "@uppy/compressor": "^3.1.0",
        "@uppy/core": "^5.2.0",
        "@uppy/dashboard": "^5.1.1",
        "@uppy/image-editor": "^4.2.0",
        "@uppy/xhr-upload": "^5.1.1"
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
