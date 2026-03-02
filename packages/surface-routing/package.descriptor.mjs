export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/surface-routing",
  version: "0.1.0",
  dependsOn: [],
  capabilities: {
    provides: [
      "runtime.surface-routing"
    ],
    requires: []
  },
  runtime: {
    server: {
      providerEntrypoint: "src/server/index.js",
      providers: [
        {
          entrypoint: "src/server/providers/SurfaceRoutingServiceProvider.js",
          export: "SurfaceRoutingServiceProvider"
        }
      ]
    },
    client: {
      providers: [
        {
          entrypoint: "src/client/providers/SurfaceRoutingClientProvider.js",
          export: "SurfaceRoutingClientProvider"
        }
      ]
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
