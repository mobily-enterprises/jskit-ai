export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/shell-web",
  version: "0.1.0",
  description: "Web shell layout runtime with outlet-based placement contributions.",
  dependsOn: [],
  capabilities: {
    provides: [
      "runtime.web-placement",
      "runtime.web-error"
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
          summary: "Exports shell layout/outlet/error-host components and ShellWebClientProvider."
        },
        {
          subpath: "./client/placement",
          summary: "Exports placement registry, placement context access, runtime token, and surface path helpers."
        },
        {
          subpath: "./client/error",
          summary: "Exports default error policy and runtime error reporter hook."
        }
      ],
      containerTokens: {
        server: [],
        client: [
          "runtime.web-placement.client",
          "runtime.web-error.client",
          "runtime.web-error.presentation-store.client"
        ]
      }
    },
    ui: {
      placements: {
        outlets: [
          {
            host: "shell-layout",
            position: "top-left",
            surfaces: ["*"],
            source: "src/client/components/ShellLayout.vue"
          },
          {
            host: "shell-layout",
            position: "top-right",
            surfaces: ["*"],
            source: "src/client/components/ShellLayout.vue"
          },
          {
            host: "shell-layout",
            position: "primary-menu",
            surfaces: ["*"],
            source: "src/client/components/ShellLayout.vue"
          },
          {
            host: "shell-layout",
            position: "secondary-menu",
            surfaces: ["*"],
            source: "src/client/components/ShellLayout.vue"
          }
        ],
        contributions: []
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@tanstack/vue-query": "^5.90.5",
        "@jskit-ai/kernel": "0.1.0",
        "vuetify": "^4.0.0"
      },
      dev: {}
    },
    packageJson: {
      scripts: {
        "dev:all": "vite",
        "dev:home": "VITE_SURFACE=home vite",
        "dev:console": "VITE_SURFACE=console vite"
      }
    },
    procfile: {},
    text: [],
    files: [
      {
        from: "templates/src/App.vue",
        to: "src/App.vue",
        reason: "Install full-width shell app root with shell-web error host and edge-to-edge layout.",
        category: "shell-web",
        id: "shell-web-app-root"
      },
      {
        from: "templates/src/components/ShellLayout.vue",
        to: "src/components/ShellLayout.vue",
        reason: "Install app-owned shell layout component so apps can customize structure and slots.",
        category: "shell-web",
        id: "shell-web-component-shell-layout"
      },
      {
        from: "templates/src/error.js",
        to: "src/error.js",
        reason: "Install app-owned error runtime policy and presenter config scaffold.",
        category: "shell-web",
        id: "shell-web-error-config"
      },
      {
        from: "templates/src/placement.js",
        to: "src/placement.js",
        reason: "Install app-owned placement registry scaffold used by shell-web placement runtime.",
        category: "shell-web",
        id: "shell-web-placement-registry"
      },
      {
        from: "templates/src/pages/home.vue",
        toSurface: "home",
        toSurfaceRoot: true,
        reason: "Install shell-driven home wrapper page.",
        category: "shell-web",
        id: "shell-web-page-home-wrapper"
      },
      {
        from: "templates/src/pages/home/index.vue",
        toSurface: "home",
        toSurfacePath: "index.vue",
        reason: "Install shell-driven home surface starter page.",
        category: "shell-web",
        id: "shell-web-page-home"
      },
      {
        from: "templates/src/pages/console.vue",
        toSurface: "console",
        toSurfaceRoot: true,
        reason: "Install shell-driven console wrapper page.",
        category: "shell-web",
        id: "shell-web-page-console-wrapper"
      },
      {
        from: "templates/src/pages/console/index.vue",
        toSurface: "console",
        toSurfacePath: "index.vue",
        reason: "Install shell-driven console page starter.",
        category: "shell-web",
        id: "shell-web-page-console"
      }
    ]
  }
});
