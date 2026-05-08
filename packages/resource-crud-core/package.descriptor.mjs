export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/resource-crud-core",
  version: "0.1.11",
  kind: "runtime",
  description: "CRUD-specific resource-definition helpers and namespace support.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@jskit-ai/resource-core"
  ],
  capabilities: {
    provides: ["resource.crud-core"],
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
        "@jskit-ai/resource-crud-core": "0.1.11"
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
