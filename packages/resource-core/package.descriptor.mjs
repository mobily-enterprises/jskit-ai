export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/resource-core",
  version: "0.1.0",
  kind: "runtime",
  description: "Generic resource-definition helpers and schema-definition normalization.",
  dependsOn: [
    "@jskit-ai/kernel"
  ],
  capabilities: {
    provides: ["resource.core"],
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
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/resource-core": "0.1.0"
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
