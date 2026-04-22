export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/console-web",
  version: "0.1.21",
  kind: "runtime",
  description: "Authenticated console surface scaffold and surface policy wiring.",
  dependsOn: [
    "@jskit-ai/auth-web",
    "@jskit-ai/console-core",
    "@jskit-ai/shell-web",
  ],
  capabilities: {
    provides: [
      "console.web"
    ],
    requires: [
      "console.core"
    ]
  },
  runtime: {
    server: {
      providers: []
    },
    client: {
      providers: []
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./client",
          summary: "Exports no runtime API today (reserved console surface package entrypoint)."
        }
      ],
      containerTokens: {
        server: [],
        client: []
      }
    },
    ui: {
      placements: {
        outlets: [
          {
            target: "console-settings:primary-menu",
            defaultLinkComponentToken: "local.main.ui.surface-aware-menu-link-item",
            surfaces: ["console"],
            source: "templates/src/pages/console/settings.vue"
          }
        ],
        contributions: [
          {
            id: "console.web.menu.settings",
            target: "shell-layout:primary-menu",
            surfaces: ["console"],
            order: 100,
            componentToken: "local.main.ui.menu-link-item",
            when: "auth.authenticated === true",
            source: "mutations.text#console-web-console-settings-placement"
          }
        ]
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/auth-web": "0.1.54",
        "@jskit-ai/console-core": "0.1.16",
        "@jskit-ai/shell-web": "0.1.52",
      },
      dev: {}
    },
    packageJson: {
      scripts: {
        "server:console": "SERVER_SURFACE=console node ./bin/server.js",
        "dev:console": "VITE_SURFACE=console vite",
        "build:console": "VITE_SURFACE=console vite build"
      }
    },
    procfile: {},
    files: [
      {
        from: "templates/src/pages/console.vue",
        toSurface: "console",
        toSurfaceRoot: true,
        ownership: "app",
        reason: "Install shell-driven console wrapper page.",
        category: "console-web",
        id: "console-web-page-console-wrapper"
      },
      {
        from: "templates/src/pages/console/index.vue",
        toSurface: "console",
        toSurfacePath: "index.vue",
        ownership: "app",
        reason: "Install shell-driven console page starter.",
        category: "console-web",
        id: "console-web-page-console"
      },
      {
        from: "templates/src/pages/console/settings.vue",
        toSurface: "console",
        toSurfacePath: "settings.vue",
        ownership: "app",
        reason: "Install console settings shell route scaffold for console-web.",
        category: "console-web",
        id: "console-web-page-console-settings-shell"
      },
      {
        from: "templates/src/pages/console/settings/index.vue",
        toSurface: "console",
        toSurfacePath: "settings/index.vue",
        ownership: "app",
        reason: "Install console settings index stub scaffold for app-owned landing or redirect behavior.",
        category: "console-web",
        id: "console-web-page-console-settings"
      }
    ],
    text: [
      {
        op: "append-text",
        file: "config/surfaceAccessPolicies.js",
        position: "bottom",
        skipIfContains: "surfaceAccessPolicies.console_owner = {",
        value: "\nsurfaceAccessPolicies.console_owner = {\n  requireAuth: true,\n  requireFlagsAll: [\"console_owner\"]\n};\n",
        reason: "Register console-owner surface access policy for the console surface.",
        category: "console-web",
        id: "console-web-surface-access-policies-console-owner"
      },
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.surfaceDefinitions.console = {",
        value:
          "\nconfig.surfaceDefinitions.console = {\n  id: \"console\",\n  label: \"Console\",\n  pagesRoot: \"console\",\n  enabled: true,\n  requiresAuth: true,\n  requiresWorkspace: false,\n  accessPolicyId: \"console_owner\",\n  icon: \"mdi-console-network-outline\",\n  origin: \"\"\n};\n",
        reason: "Register console surface definition once console-web is installed.",
        category: "console-web",
        id: "console-web-surface-config-console"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"console.web.menu.settings\"",
        value:
          "\naddPlacement({\n  id: \"console.web.menu.settings\",\n  target: \"shell-layout:primary-menu\",\n  surfaces: [\"console\"],\n  order: 100,\n  componentToken: \"local.main.ui.menu-link-item\",\n  props: {\n    label: \"Settings\",\n    to: \"/console/settings\",\n    icon: \"mdi-cog-outline\"\n  },\n  when: ({ auth }) => auth?.authenticated === true\n});\n",
        reason: "Append console-web settings menu placement into app-owned placement registry.",
        category: "console-web",
        id: "console-web-console-settings-placement"
      }
    ]
  }
});
