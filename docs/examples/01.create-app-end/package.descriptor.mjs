export default Object.freeze({
  packageVersion: 1,
  packageId: "@manual-app/examples-create-app-01-end",
  version: "0.1.0",
  description: "Chapter 1 end-state example with a basic provider and route.",
  dependsOn: [],
  capabilities: {
    provides: [],
    requires: []
  },
  options: {},
  runtime: {
    server: {
      providerEntrypoint: "src/server/index.js",
      providers: [
        {
          entrypoint: "src/server/providers/MainHelloProvider.js",
          export: "MainHelloProvider"
        }
      ]
    },
    client: {
      providers: []
    }
  },
  metadata: {
    server: {
      routes: [
        {
          method: "GET",
          path: "/api/v1/docs/ch01/hello"
        }
      ]
    },
    ui: {
      routes: [],
      elements: [],
      overrides: []
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
    text: [],
    files: []
  }
});
