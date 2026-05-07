export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/google-rewarded-web",
  version: "0.1.2",
  kind: "runtime",
  description: "Google rewarded client runtime with a fullscreen gate host and GPT orchestration.",
  dependsOn: [
    "@jskit-ai/google-rewarded-core",
    "@jskit-ai/http-runtime",
    "@jskit-ai/kernel",
    "@jskit-ai/shell-web"
  ],
  capabilities: {
    provides: ["google-rewarded.web"],
    requires: []
  },
  runtime: {
    server: {
      providers: []
    },
    client: {
      providers: [
        {
          entrypoint: "src/client/providers/GoogleRewardedClientProvider.js",
          export: "GoogleRewardedClientProvider"
        }
      ]
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./client",
          summary: "Exports the Google rewarded client provider, runtime composable, and fullscreen gate host."
        }
      ],
      containerTokens: {
        server: [],
        client: [
          "google-rewarded.web.runtime"
        ]
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/google-rewarded-core": "0.1.2",
        "@jskit-ai/http-runtime": "0.1.64",
        "@jskit-ai/kernel": "0.1.65",
        "@jskit-ai/shell-web": "0.1.64"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    vite: {
      proxy: []
    },
    text: [],
    files: []
  }
});
