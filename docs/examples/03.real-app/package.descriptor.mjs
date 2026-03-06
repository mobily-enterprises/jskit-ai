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
      providerEntrypoint: "src/server/index.js",
      providers: [
        {
          entrypoint: "src/server/providers/ContactProviderStage1.js",
          export: "ContactProviderStage1"
        },
        {
          entrypoint: "src/server/providers/ContactProviderStage2.js",
          export: "ContactProviderStage2"
        },
        {
          entrypoint: "src/server/providers/ContactProviderStage3.js",
          export: "ContactProviderStage3"
        },
        {
          entrypoint: "src/server/providers/ContactProviderStage4.js",
          export: "ContactProviderStage4"
        },
        {
          entrypoint: "src/server/providers/ContactProviderStage5.js",
          export: "ContactProviderStage5"
        },
        {
          entrypoint: "src/server/providers/ContactProviderStage6.js",
          export: "ContactProviderStage6"
        },
        {
          entrypoint: "src/server/providers/ContactProviderStage7.js",
          export: "ContactProviderStage7"
        },
        {
          entrypoint: "src/server/providers/ContactProviderStage8.js",
          export: "ContactProviderStage8"
        },
        {
          entrypoint: "src/server/providers/ContactProviderStage9.js",
          export: "ContactProviderStage9"
        },
        {
          entrypoint: "src/server/providers/ContactProviderStage10.js",
          export: "ContactProviderStage10"
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
        { method: "POST", path: "/api/v1/docs/ch03/stage-6/contacts/intake" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-6/contacts/preview-followup" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-7/contacts/intake" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-7/contacts/preview-followup" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-8/contacts/intake" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-8/contacts/preview-followup" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-9/contacts/intake" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-9/contacts/preview-followup" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-10/contacts/intake" },
        { method: "POST", path: "/api/v1/docs/ch03/stage-10/contacts/preview-followup" }
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
