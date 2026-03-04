export default Object.freeze({
  packageVersion: 1,
  packageId: "@manual-app/tut-custom-client-routes-dec",
  version: "0.1.0",
  description: "Tutorial module: declarative client route registration.",
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
          id: "tut.dec.declarative",
          path: "/tut/dec-declarative",
          scope: "global",
          name: "tut-dec-declarative",
          componentKey: "tut-dec-declarative",
          autoRegister: true,
          guard: {
            policy: "public"
          },
          purpose: "Declarative tutorial route."
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
