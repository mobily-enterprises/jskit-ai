export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/container-core",
  version: "0.1.0",
  dependsOn: [],
  capabilities: {
    provides: [
      "runtime.container"
    ],
    requires: []
  },
  runtime: {
    server: {
      providerEntrypoint: "src/server/index.js",
      providers: [
        {
          entrypoint: "src/server/providers/ContainerCoreServiceProvider.js",
          export: "ContainerCoreServiceProvider"
        }
      ]
    },
    client: {
      providers: [
        {
          entrypoint: "src/client/providers/ContainerCoreClientProvider.js",
          export: "ContainerCoreClientProvider"
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
