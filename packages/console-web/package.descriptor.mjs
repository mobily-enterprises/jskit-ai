export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/console-web",
  version: "0.1.34",
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
            surfaces: ["console"],
            source: "templates/src/pages/console/settings.vue"
          }
        ],
        topology: {
          placements: [
            {
              id: "page.section-nav",
              owner: "console-settings",
              description: "Navigation between console settings child pages.",
              surfaces: ["console"],
              variants: {
                compact: {
                  outlet: "console-settings:primary-menu",
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                },
                medium: {
                  outlet: "console-settings:primary-menu",
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                },
                expanded: {
                  outlet: "console-settings:primary-menu",
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                }
              }
            }
          ]
        },
        contributions: [
          {
            id: "console.web.profile.menu.console",
            target: "auth.profile-menu",
            kind: "link",
            surfaces: ["*"],
            order: 600,
            when: "auth.authenticated === true && surfaceAccess.consoleowner === true && surface !== \"console\"",
            source: "mutations.text#console-web-profile-menu-console-placement"
          },
          {
            id: "console.web.menu.settings",
            target: "shell.primary-nav",
            kind: "link",
            surfaces: ["console"],
            order: 100,
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
        "@jskit-ai/auth-web": "0.1.67",
        "@jskit-ai/console-core": "0.1.29",
        "@jskit-ai/shell-web": "0.1.65",
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
          "\nconfig.surfaceDefinitions.console = {\n  id: \"console\",\n  label: \"Console\",\n  pagesRoot: \"console\",\n  enabled: true,\n  requiresAuth: true,\n  requiresWorkspace: false,\n  accessPolicyId: \"console_owner\",\n  icon: \"mdi-console-network-outline\",\n  showInSurfaceSwitchMenu: false,\n  origin: \"\"\n};\n",
        reason: "Register console surface definition once console-web is installed.",
        category: "console-web",
        id: "console-web-surface-config-console"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"console.web.profile.menu.console\"",
        value:
          "\naddPlacement({\n  id: \"console.web.profile.menu.console\",\n  target: \"auth.profile-menu\",\n  kind: \"link\",\n  surfaces: [\"*\"],\n  order: 600,\n  props: {\n    label: \"Go to console\",\n    to: \"/console\",\n    icon: \"mdi-console-network-outline\"\n  },\n  when: ({ auth, surfaceAccess, surface }) => {\n    return auth?.authenticated === true && surfaceAccess?.consoleowner === true && surface !== \"console\";\n  }\n});\n",
        reason: "Append owner-only console navigation entry into the authenticated profile menu outside the console surface.",
        category: "console-web",
        id: "console-web-profile-menu-console-placement"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"console.web.menu.settings\"",
        value:
          "\naddPlacement({\n  id: \"console.web.menu.settings\",\n  target: \"shell.primary-nav\",\n  kind: \"link\",\n  surfaces: [\"console\"],\n  order: 100,\n  props: {\n    label: \"Settings\",\n    to: \"/console/settings\",\n    icon: \"mdi-cog-outline\"\n  },\n  when: ({ auth }) => auth?.authenticated === true\n});\n",
        reason: "Append console-web settings menu placement into app-owned placement registry.",
        category: "console-web",
        id: "console-web-console-settings-placement"
      },
      {
        op: "append-text",
        file: "src/placementTopology.js",
        position: "bottom",
        skipIfContains: "owner: \"console-settings\"",
        value:
          "\naddPlacementTopology({\n  id: \"page.section-nav\",\n  owner: \"console-settings\",\n  description: \"Navigation between console settings child pages.\",\n  surfaces: [\"console\"],\n  variants: {\n    compact: {\n      outlet: \"console-settings:primary-menu\",\n      renderers: {\n        link: \"local.main.ui.surface-aware-menu-link-item\"\n      }\n    },\n    medium: {\n      outlet: \"console-settings:primary-menu\",\n      renderers: {\n        link: \"local.main.ui.surface-aware-menu-link-item\"\n      }\n    },\n    expanded: {\n      outlet: \"console-settings:primary-menu\",\n      renderers: {\n        link: \"local.main.ui.surface-aware-menu-link-item\"\n      }\n    }\n  }\n});\n",
        reason: "Append console settings semantic topology into app-owned placement topology.",
        category: "console-web",
        id: "console-web-settings-placement-topology"
      }
    ]
  }
});
