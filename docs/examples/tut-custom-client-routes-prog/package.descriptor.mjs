export default Object.freeze({
  packageVersion: 1,
  packageId: "@manual-app/tut-custom-client-routes-prog",
  version: "0.1.0",
  description: "Tutorial module: programmatic client route registration.",
  dependsOn: [],
  capabilities: {
    provides: [],
    requires: []
  },
  options: {},
  runtime: {
    server: {
      providers: []
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
      routes: [
        {
          id: "tut.prog.programmatic",
          path: "/tut/prog-programmatic",
          scope: "global",
          autoRegister: false
        }
      ],
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
