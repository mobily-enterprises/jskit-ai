export default Object.freeze({
  packageVersion: 1,
  packageId: "@manual-app/examples-real-app-03",
  version: "0.1.0",
  description: "Chapter 3 staged real-app architecture examples.",
  dependsOn: [],
  capabilities: {
    provides: [],
    requires: []
  },
  options: {},
  runtime: {
    server: {
      providerEntrypoint: "stages/server/index.js",
      providers: [
        {
          entrypoint: "stages/server/providers/ContactProviderStage1.js",
          export: "ContactProviderStage1"
        },
        {
          entrypoint: "stages/server/providers/ContactProviderStage2.js",
          export: "ContactProviderStage2"
        },
        {
          entrypoint: "stages/server/providers/ContactProviderStage3.js",
          export: "ContactProviderStage3"
        },
        {
          entrypoint: "stages/server/providers/ContactProviderStage4.js",
          export: "ContactProviderStage4"
        },
        {
          entrypoint: "stages/server/providers/ContactProviderStage5.js",
          export: "ContactProviderStage5"
        },
        {
          entrypoint: "stages/server/providers/ContactProviderStage7.js",
          export: "ContactProviderStage7"
        },
        {
          entrypoint: "stages/server/providers/ContactProviderStage8.js",
          export: "ContactProviderStage8"
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
        { method: "POST", path: "/api/v1/docs/ch03/stage-1/contacts/intake" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-1/contacts/preview-followup" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-2/contacts/intake" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-2/contacts/preview-followup" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-3/contacts/intake" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-3/contacts/preview-followup" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-4/contacts/intake" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-4/contacts/preview-followup" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-5/contacts/intake" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-5/contacts/preview-followup" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-7/contacts/intake" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-7/contacts/preview-followup" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-8/contacts/intake" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-8/contacts/preview-followup" }
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
