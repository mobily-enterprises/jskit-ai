export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/main",
  version: "0.1.0",
  description: "App-local main module scaffold.",
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
          discover: {
            dir: "src/server/providers",
            pattern: "*Provider.js"
          }
        }
      ]
    },
    client: {
      providers: []
    }
  },
  metadata: {
    server: {
      routes: []
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
