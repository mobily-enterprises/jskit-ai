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
          entrypoint: "src/server/providers/Stage1MonolithProvider.js",
          export: "Stage1MonolithProvider"
        },
        {
          entrypoint: "src/server/providers/Stage2ControllerProvider.js",
          export: "Stage2ControllerProvider"
        },
        {
          entrypoint: "src/server/providers/Stage3ServiceProvider.js",
          export: "Stage3ServiceProvider"
        },
        {
          entrypoint: "src/server/providers/Stage4RepositoryProvider.js",
          export: "Stage4RepositoryProvider"
        },
        {
          entrypoint: "src/server/providers/Stage5ActionProvider.js",
          export: "Stage5ActionProvider"
        },
        {
          entrypoint: "src/server/providers/Stage6LayeredProvider.js",
          export: "Stage6LayeredProvider"
        },
        {
          entrypoint: "src/server/providers/Stage7RequestPipelineProvider.js",
          export: "Stage7RequestPipelineProvider"
        },
        {
          entrypoint: "src/server/providers/Stage8ErrorErgonomicsProvider.js",
          export: "Stage8ErrorErgonomicsProvider"
        },
        {
          entrypoint: "src/server/providers/Stage9RuntimeContextProvider.js",
          export: "Stage9RuntimeContextProvider"
        },
        {
          entrypoint: "src/server/providers/Stage10ConfigContractProvider.js",
          export: "Stage10ConfigContractProvider"
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
