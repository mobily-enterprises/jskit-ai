export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/crud-core",
  version: "0.1.46",
  kind: "runtime",
  description: "Shared CRUD helpers used by CRUD modules.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@jskit-ai/realtime",
    "@jskit-ai/shell-web",
    "@jskit-ai/users-core",
    "@jskit-ai/users-web"
  ],
  capabilities: {
    provides: ["crud.core"],
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
        "@jskit-ai/crud-core": "0.1.46"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: []
  }
});
