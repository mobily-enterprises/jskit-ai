export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/shell-web",
  version: "0.1.65",
  kind: "runtime",
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
          summary: "Exports shell layout/outlet/outlet-menu/error-host components and ShellWebClientProvider."
        },
        {
          subpath: "./client/placement",
          summary: "Exports placement registry, placement context access, runtime token, and surface path helpers."
        },
        {
          subpath: "./client/error",
          summary: "Exports default error policy and runtime error reporter hook."
        },
        {
          subpath: "./client/bootstrap",
          summary: "Exports the shared client bootstrap handler registry used to extend /api/bootstrap handling."
        }
      ],
      containerTokens: {
        server: [],
        client: [
          "runtime.web-placement.client",
          "runtime.web-bootstrap.client",
          "runtime.web-error.client",
          "runtime.web-error.presentation-store.client",
          "shell.web.query-client"
        ]
      }
    },
    ui: {
      placements: {
        outlets: [
          {
            target: "shell-layout:top-left",
            surfaces: ["*"],
            source: "src/client/components/ShellLayout.vue"
          },
          {
            target: "shell-layout:top-right",
            surfaces: ["*"],
            source: "src/client/components/ShellLayout.vue"
          },
          {
            target: "shell-layout:primary-menu",
            surfaces: ["*"],
            source: "src/client/components/ShellLayout.vue"
          },
          {
            target: "shell-layout:secondary-menu",
            surfaces: ["*"],
            source: "src/client/components/ShellLayout.vue"
          },
          {
            target: "home-settings:primary-menu",
            surfaces: ["home"],
            source: "templates/src/pages/home/settings.vue"
          }
        ],
        topology: {
          placements: [
            {
              id: "shell.primary-nav",
              description: "Primary top-level navigation for the current surface.",
              surfaces: ["*"],
              default: true,
              variants: {
                compact: {
                  outlet: "shell-layout:primary-menu",
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                },
                medium: {
                  outlet: "shell-layout:primary-menu",
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                },
                expanded: {
                  outlet: "shell-layout:primary-menu",
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                }
              }
            },
            {
              id: "shell.status",
              description: "Surface status, connection, and utility indicators.",
              surfaces: ["*"],
              variants: {
                compact: {
                  outlet: "shell-layout:top-right"
                },
                medium: {
                  outlet: "shell-layout:top-right"
                },
                expanded: {
                  outlet: "shell-layout:top-right"
                }
              }
            },
            {
              id: "shell.secondary-nav",
              description: "Secondary navigation for lower-priority shell links.",
              surfaces: ["*"],
              variants: {
                compact: {
                  outlet: "shell-layout:secondary-menu",
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                },
                medium: {
                  outlet: "shell-layout:secondary-menu",
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                },
                expanded: {
                  outlet: "shell-layout:secondary-menu",
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                }
              }
            },
            {
              id: "shell.identity",
              description: "Current user, workspace, and surface identity controls.",
              surfaces: ["*"],
              variants: {
                compact: {
                  outlet: "shell-layout:top-left"
                },
                medium: {
                  outlet: "shell-layout:top-left"
                },
                expanded: {
                  outlet: "shell-layout:top-left"
                }
              }
            },
            {
              id: "page.section-nav",
              owner: "home-settings",
              description: "Navigation between child pages in the home settings section.",
              surfaces: ["home"],
              variants: {
                compact: {
                  outlet: "home-settings:primary-menu",
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                },
                medium: {
                  outlet: "home-settings:primary-menu",
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                },
                expanded: {
                  outlet: "home-settings:primary-menu",
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
            id: "shell-web.home.menu.home",
            target: "shell.primary-nav",
            kind: "link",
            surfaces: ["home"],
            order: 50,
            source: "templates/src/placement.js"
          },
          {
            id: "shell-web.home.menu.settings",
            target: "shell.primary-nav",
            kind: "link",
            surfaces: ["home"],
            order: 100,
            source: "templates/src/placement.js"
          },
          {
            id: "shell-web.home.settings.general",
            target: "page.section-nav",
            owner: "home-settings",
            kind: "link",
            surfaces: ["home"],
            order: 100,
            source: "templates/src/placement.js"
          }
        ]
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@mdi/js": "^7.4.47",
        "@tanstack/vue-query": "^5.90.5",
        "@jskit-ai/kernel": "0.1.66",
        "vuetify": "^4.0.0"
      },
      dev: {}
    },
    packageJson: {
      scripts: {
        "dev:all": "vite",
        "dev:home": "VITE_SURFACE=home vite"
      }
    },
    procfile: {},
    text: [
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "top",
        skipIfContains: "import MenuLinkItem from \"/src/components/menus/MenuLinkItem.vue\";",
        value: "import MenuLinkItem from \"/src/components/menus/MenuLinkItem.vue\";\n",
        reason: "Bind app-owned shell menu link-item scaffold into local main client provider imports.",
        category: "shell-web",
        id: "shell-web-main-client-provider-menu-link-item-import"
      },
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "top",
        skipIfContains: "import SurfaceAwareMenuLinkItem from \"/src/components/menus/SurfaceAwareMenuLinkItem.vue\";",
        value: "import SurfaceAwareMenuLinkItem from \"/src/components/menus/SurfaceAwareMenuLinkItem.vue\";\n",
        reason: "Bind app-owned shell surface-aware menu link-item scaffold into local main client provider imports.",
        category: "shell-web",
        id: "shell-web-main-client-provider-surface-aware-menu-link-item-import"
      },
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "top",
        skipIfContains: "import TabLinkItem from \"/src/components/menus/TabLinkItem.vue\";",
        value: "import TabLinkItem from \"/src/components/menus/TabLinkItem.vue\";\n",
        reason: "Bind app-owned shell tab link-item scaffold into local main client provider imports.",
        category: "shell-web",
        id: "shell-web-main-client-provider-tab-link-item-import"
      },
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "bottom",
        skipIfContains: "registerMainClientComponent(\"local.main.ui.menu-link-item\", () => MenuLinkItem);",
        value: "\nregisterMainClientComponent(\"local.main.ui.menu-link-item\", () => MenuLinkItem);\n",
        reason: "Bind app-owned shell menu link-item token into local main client provider registry.",
        category: "shell-web",
        id: "shell-web-main-client-provider-menu-link-item-register"
      },
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "bottom",
        skipIfContains: "registerMainClientComponent(\"local.main.ui.surface-aware-menu-link-item\", () => SurfaceAwareMenuLinkItem);",
        value: "\nregisterMainClientComponent(\"local.main.ui.surface-aware-menu-link-item\", () => SurfaceAwareMenuLinkItem);\n",
        reason: "Bind app-owned shell surface-aware menu link-item token into local main client provider registry.",
        category: "shell-web",
        id: "shell-web-main-client-provider-surface-aware-menu-link-item-register"
      },
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "bottom",
        skipIfContains: "registerMainClientComponent(\"local.main.ui.tab-link-item\", () => TabLinkItem);",
        value: "\nregisterMainClientComponent(\"local.main.ui.tab-link-item\", () => TabLinkItem);\n",
        reason: "Bind app-owned shell tab link-item token into local main client provider registry.",
        category: "shell-web",
        id: "shell-web-main-client-provider-tab-link-item-register"
      }
    ],
    files: [
      {
        from: "templates/src/App.vue",
        to: "src/App.vue",
        ownership: "app",
        expectedExistingFrom: "templates/expected-existing/src/App.vue",
        reason: "Install full-width shell app root with shell-web error host and edge-to-edge layout.",
        category: "shell-web",
        id: "shell-web-app-root"
      },
      {
        from: "templates/src/components/ShellLayout.vue",
        to: "src/components/ShellLayout.vue",
        ownership: "app",
        reason: "Install app-owned shell layout component so apps can customize structure and slots.",
        category: "shell-web",
        id: "shell-web-component-shell-layout"
      },
      {
        from: "templates/src/components/menus/MenuLinkItem.vue",
        to: "src/components/menus/MenuLinkItem.vue",
        ownership: "app",
        reason: "Install app-owned shell menu link-item scaffold for local placement customization.",
        category: "shell-web",
        id: "shell-web-component-menu-link-item"
      },
      {
        from: "templates/src/components/menus/SurfaceAwareMenuLinkItem.vue",
        to: "src/components/menus/SurfaceAwareMenuLinkItem.vue",
        ownership: "app",
        reason: "Install app-owned surface-aware shell menu link-item scaffold for local placement customization.",
        category: "shell-web",
        id: "shell-web-component-surface-aware-menu-link-item"
      },
      {
        from: "templates/src/components/menus/TabLinkItem.vue",
        to: "src/components/menus/TabLinkItem.vue",
        ownership: "app",
        reason: "Install app-owned shell tab link-item scaffold for local placement customization.",
        category: "shell-web",
        id: "shell-web-component-tab-link-item"
      },
      {
        from: "templates/src/error.js",
        to: "src/error.js",
        ownership: "app",
        reason: "Install app-owned error runtime policy and presenter config scaffold.",
        category: "shell-web",
        id: "shell-web-error-config"
      },
      {
        from: "templates/src/placement.js",
        to: "src/placement.js",
        ownership: "app",
        reason: "Install app-owned placement registry scaffold used by shell-web placement runtime.",
        category: "shell-web",
        id: "shell-web-placement-registry"
      },
      {
        from: "templates/src/placementTopology.js",
        to: "src/placementTopology.js",
        ownership: "app",
        reason: "Install app-owned semantic placement topology used by shell-web placement runtime.",
        category: "shell-web",
        id: "shell-web-placement-topology"
      },
      {
        from: "templates/src/pages/home.vue",
        toSurface: "home",
        toSurfaceRoot: true,
        ownership: "app",
        expectedExistingFrom: "templates/expected-existing/src/pages/home.vue",
        reason: "Install shell-driven home wrapper page.",
        category: "shell-web",
        id: "shell-web-page-home-wrapper"
      },
      {
        from: "templates/src/pages/home/index.vue",
        toSurface: "home",
        toSurfacePath: "index.vue",
        ownership: "app",
        expectedExistingFrom: "templates/expected-existing/src/pages/home/index.vue",
        reason: "Install shell-driven home surface starter page.",
        category: "shell-web",
        id: "shell-web-page-home"
      },
      {
        from: "templates/src/pages/home/settings.vue",
        toSurface: "home",
        toSurfacePath: "settings.vue",
        ownership: "app",
        reason: "Install shell-driven home settings shell route with section navigation.",
        category: "shell-web",
        id: "shell-web-page-home-settings-shell"
      },
      {
        from: "templates/src/pages/home/settings/index.vue",
        toSurface: "home",
        toSurfacePath: "settings/index.vue",
        ownership: "app",
        reason: "Install shell-driven home settings redirect so the starter settings shell lands on a real child page.",
        category: "shell-web",
        id: "shell-web-page-home-settings"
      },
      {
        from: "templates/src/pages/home/settings/general/index.vue",
        toSurface: "home",
        toSurfacePath: "settings/general/index.vue",
        ownership: "app",
        reason: "Install shell-driven general settings child page with a tiny browser-local shell preference example.",
        category: "shell-web",
        id: "shell-web-page-home-settings-general"
      }
    ]
  }
});
