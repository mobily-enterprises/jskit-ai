export default Object.freeze({
  packageVersion: 1,
  packageId: "@manual-app/examples-kernel-02",
  version: "0.1.0",
  description: "Chapter 2 kernel examples: app/provider everyday patterns.",
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
          entrypoint: "src/server/providers/BindExampleProvider.js",
          export: "BindExampleProvider"
        },
        {
          entrypoint: "src/server/providers/DependsOnBaseExampleProvider.js",
          export: "DependsOnBaseExampleProvider"
        },
        {
          entrypoint: "src/server/providers/DependsOnExampleProvider.js",
          export: "DependsOnExampleProvider"
        },
        {
          entrypoint: "src/server/providers/SingletonExampleProvider.js",
          export: "SingletonExampleProvider"
        },
        {
          entrypoint: "src/server/providers/ScopedExampleProvider.js",
          export: "ScopedExampleProvider"
        },
        {
          entrypoint: "src/server/providers/InstanceExampleProvider.js",
          export: "InstanceExampleProvider"
        },
        {
          entrypoint: "src/server/providers/MakeExampleProvider.js",
          export: "MakeExampleProvider"
        },
        {
          entrypoint: "src/server/providers/HasExampleProvider.js",
          export: "HasExampleProvider"
        },
        {
          entrypoint: "src/server/providers/TagExampleProvider.js",
          export: "TagExampleProvider"
        },
        {
          entrypoint: "src/server/providers/ResolveTagExampleProvider.js",
          export: "ResolveTagExampleProvider"
        },
        {
          entrypoint: "src/server/providers/CreateScopeExampleProvider.js",
          export: "CreateScopeExampleProvider"
        },
        {
          entrypoint: "src/server/providers/ShutdownExampleProvider.js",
          export: "ShutdownExampleProvider"
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
