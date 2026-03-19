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
            slot: "app.top-left",
            surfaces: ["*"],
            source: "src/client/components/ShellLayout.vue"
          },
          {
            slot: "app.top-right",
            surfaces: ["*"],
            source: "src/client/components/ShellLayout.vue"
          },
          {
            slot: "app.primary-menu",
            surfaces: ["*"],
            source: "src/client/components/ShellLayout.vue"
          },
          {
            slot: "app.secondary-menu",
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
        "dev:app": "VITE_SURFACE=app vite",
        "dev:admin": "VITE_SURFACE=admin vite",
        "dev:console": "VITE_SURFACE=console vite"
      }
    },
    procfile: {},
    text: [
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        value:
          "\nconfig.surfaceDefinitions.admin = {\n  id: \"admin\",\n  prefix: \"/admin\",\n  enabled: true,\n  requiresAuth: true,\n  requiresWorkspace: true\n};\n\nconfig.surfaceDefinitions.console = {\n  id: \"console\",\n  prefix: \"/console\",\n  enabled: true,\n  requiresAuth: true,\n  requiresWorkspace: false\n};\n",
        reason: "Own shell surface topology in app config, shaped by tenancy mode.",
        category: "shell-web",
        id: "shell-web-surface-config-workspace-enabled",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspace"]
        }
      },
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        value:
          "\nconfig.surfaceDefinitions.console = {\n  id: \"console\",\n  prefix: \"/console\",\n  enabled: true,\n  requiresAuth: true,\n  requiresWorkspace: false\n};\n",
        reason: "Own shell surface topology in app config, shaped by tenancy mode.",
        category: "shell-web",
        id: "shell-web-surface-config-no-workspace",
        when: {
          config: "tenancyMode",
          notIn: ["personal", "workspace"]
        }
      }
    ],
    files: [
      {
        from: "templates/src/App.vue",
        to: "src/App.vue",
        reason: "Install full-width shell app root with shell-web error host and edge-to-edge layout.",
        category: "shell-web",
        id: "shell-web-app-root"
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
        from: "templates/src/pages/index.vue",
        to: "src/pages/index.vue",
        reason: "Install shell-driven root page starter.",
        category: "shell-web",
        id: "shell-web-page-root"
      },
      {
        from: "templates/src/pages/admin.vue",
        to: "src/pages/admin.vue",
        reason: "Install shell-driven admin wrapper page.",
        category: "shell-web",
        id: "shell-web-page-admin-wrapper",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspace"]
        }
      },
      {
        from: "templates/src/pages/console.vue",
        to: "src/pages/console.vue",
        reason: "Install shell-driven console wrapper page.",
        category: "shell-web",
        id: "shell-web-page-console-wrapper"
      },
      {
        from: "templates/src/pages/admin/index.vue",
        to: "src/pages/admin/index.vue",
        reason: "Install shell-driven admin page starter.",
        category: "shell-web",
        id: "shell-web-page-admin",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspace"]
        }
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
