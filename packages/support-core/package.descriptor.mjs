export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/support-core",
  version: "0.1.0",
  dependsOn: [],
  capabilities: {
    provides: [
      "runtime.support"
    ],
    requires: []
  },
  runtime: {
    server: {
      providerEntrypoint: "src/server/index.js",
      providers: [
        {
          entrypoint: "src/server/providers/SupportCoreServiceProvider.js",
          export: "SupportCoreServiceProvider"
        }
      ]
    },
    client: {
      providers: [
        {
          entrypoint: "src/client/providers/SupportCoreClientProvider.js",
          export: "SupportCoreClientProvider"
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
