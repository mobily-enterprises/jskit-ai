export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/shell-web",
  version: "0.1.0",
  description: "Web shell layout runtime with outlet-based placement contributions.",
  dependsOn: [],
  capabilities: {
    provides: [
      "runtime.web-placement"
    ],
    requires: []
  },
  runtime: {
    server: {
      providers: []
    },
    client: {
      providers: [
        {
          entrypoint: "src/client/providers/ShellWebClientProvider.js",
          export: "ShellWebClientProvider"
        }
      ]
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./client",
          summary: "Exports shell layout/outlet components, placement helpers, and ShellWebClientProvider."
        },
        {
          subpath: "./client/placement",
          summary: "Exports app-owned placement registry helpers, slot contracts, and placement runtime tokens."
        }
      ],
      containerTokens: {
        server: [],
        client: [
          "runtime.web-placement.client"
        ]
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/kernel": "0.1.0",
        "vuetify": "^4.0.0"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [
      {
        from: "templates/src/App.vue",
        to: "src/App.vue",
        reason: "Install full-width shell app root so shell layouts render edge-to-edge.",
        category: "shell-web",
        id: "shell-web-app-root"
      },
      {
        from: "templates/src/placement.js",
        to: "src/placement.js",
        reason: "Install app-owned placement registry scaffold used by shell-web placement runtime.",
        category: "shell-web",
        id: "shell-web-placement-registry"
      },
      {
        from: "templates/src/pages/index.vue",
        to: "src/pages/index.vue",
        reason: "Install shell-driven root page starter.",
        category: "shell-web",
        id: "shell-web-page-root"
      },
      {
        from: "templates/src/pages/admin/index.vue",
        to: "src/pages/admin/index.vue",
        reason: "Install shell-driven admin page starter.",
        category: "shell-web",
        id: "shell-web-page-admin"
      },
      {
        from: "templates/src/pages/app/index.vue",
        to: "src/pages/app/index.vue",
        reason: "Install shell-driven app page starter.",
        category: "shell-web",
        id: "shell-web-page-app"
      },
      {
        from: "templates/src/pages/console/index.vue",
        to: "src/pages/console/index.vue",
        reason: "Install shell-driven console page starter.",
        category: "shell-web",
        id: "shell-web-page-console"
      }
    ]
  }
});
