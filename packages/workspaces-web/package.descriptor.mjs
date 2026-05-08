export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/workspaces-web",
  version: "0.1.41",
  kind: "runtime",
  description: "Workspace web module: workspace selector, tools widget, workspace surfaces, and members/settings UI.",
  dependsOn: [
    "@jskit-ai/workspaces-core",
    "@jskit-ai/users-web"
  ],
  capabilities: {
    provides: [
      "workspaces.web"
    ],
    requires: [
      "users.web",
      "workspaces.core"
    ]
  },
  runtime: {
    server: {
      providers: []
    },
    client: {
      providers: [
        {
          entrypoint: "src/client/providers/WorkspacesWebClientProvider.js",
          export: "WorkspacesWebClientProvider"
        }
      ]
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./client",
          summary: "Exports workspaces-web client provider registration surface."
        },
        {
          subpath: "./client/components/AccountSettingsInvitesSection",
          summary: "Exports the default account invites section component used by multihoming installs."
        },
        {
          subpath: "./client/providers/WorkspacesWebClientProvider",
          summary: "Exports workspaces-web client provider class."
        },
        {
          subpath: "./client/composables/useWorkspaceRouteContext",
          summary: "Exports workspace route context composable."
        }
      ],
      containerTokens: {
        server: [],
        client: [
          "workspaces.web.profile.menu.surface-switch-item",
          "workspaces.web.workspace.selector",
          "workspaces.web.workspace.tools.widget",
          "workspaces.web.workspace-settings.menu-item",
          "workspaces.web.workspace-members.menu-item",
          "workspaces.web.members-admin.element",
          "workspaces.web.bootstrap-placement.runtime",
          "workspaces.web.scope-support"
        ]
      }
    },
    ui: {
      placements: {
        outlets: [
          {
            target: "admin-settings:primary-menu",
            surfaces: ["admin"],
            source: "templates/src/pages/admin/workspace/settings.vue"
          },
          {
            target: "admin-cog:primary-menu",
            surfaces: ["admin"],
            source: "src/client/components/UsersWorkspaceToolsWidget.vue"
          }
        ],
        topology: {
          placements: [
            {
              id: "page.section-nav",
              owner: "admin-settings",
              description: "Navigation between workspace admin settings child pages.",
              surfaces: ["admin"],
              variants: {
                compact: {
                  outlet: "admin-settings:primary-menu",
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                },
                medium: {
                  outlet: "admin-settings:primary-menu",
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                },
                expanded: {
                  outlet: "admin-settings:primary-menu",
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                }
              }
            },
            {
              id: "admin.tools-menu",
              description: "Admin surface tools menu actions.",
              surfaces: ["admin"],
              variants: {
                compact: {
                  outlet: "admin-cog:primary-menu",
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                },
                medium: {
                  outlet: "admin-cog:primary-menu",
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                },
                expanded: {
                  outlet: "admin-cog:primary-menu",
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
            id: "workspaces.workspace.menu.app",
            target: "shell.primary-nav",
            kind: "link",
            surfaces: ["app"],
            order: 50,
            when: "auth.authenticated === true",
            source: "mutations.text#workspaces-web-placement-block"
          },
          {
            id: "workspaces.workspace.menu.admin",
            target: "shell.primary-nav",
            kind: "link",
            surfaces: ["admin"],
            order: 60,
            when: "auth.authenticated === true",
            source: "mutations.text#workspaces-web-placement-block"
          },
          {
            id: "workspaces.profile.menu.surface-switch",
            target: "auth.profile-menu",
            kind: "component",
            surfaces: ["*"],
            order: 100,
            componentToken: "workspaces.web.profile.menu.surface-switch-item",
            when: "auth.authenticated === true",
            source: "mutations.text#workspaces-web-profile-surface-switch-placement"
          },
          {
            id: "workspaces.workspace.selector",
            target: "shell.identity",
            kind: "component",
            surfaces: ["*"],
            order: 200,
            componentToken: "workspaces.web.workspace.selector",
            when: "auth.authenticated === true",
            source: "mutations.text#workspaces-web-placement-block"
          },
          {
            id: "workspaces.account.invites.cue",
            target: "shell.status",
            kind: "component",
            surfaces: ["*"],
            order: 850,
            componentToken: "local.main.account.pending-invites.cue",
            when: "auth.authenticated === true",
            source: "mutations.text#workspaces-web-placement-block"
          },
          {
            id: "workspaces.account.settings.invites",
            target: "settings.sections",
            owner: "account-settings",
            kind: "component",
            surfaces: ["account"],
            order: 400,
            componentToken: "local.main.account-settings.section.invites",
            when: "auth.authenticated === true && workspaceInvitesEnabled === true",
            source: "mutations.text#workspaces-web-account-settings-placement"
          },
          {
            id: "workspaces.workspace.tools.widget",
            target: "shell.status",
            kind: "component",
            surfaces: ["admin"],
            order: 900,
            componentToken: "workspaces.web.workspace.tools.widget",
            source: "mutations.text#workspaces-web-placement-block"
          },
          {
            id: "workspaces.workspace.menu.workspace-settings",
            target: "admin.tools-menu",
            kind: "component",
            surfaces: ["admin"],
            order: 100,
            componentToken: "workspaces.web.workspace-settings.menu-item",
            source: "mutations.text#workspaces-web-placement-block"
          },
          {
            id: "workspaces.workspace.menu.members",
            target: "admin.tools-menu",
            kind: "component",
            surfaces: ["admin"],
            order: 200,
            componentToken: "workspaces.web.workspace-members.menu-item",
            source: "mutations.text#workspaces-web-placement-block"
          },
        ]
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/workspaces-core": "0.1.41",
        "@jskit-ai/users-web": "0.1.80",
        "vuetify": "^4.0.0"
      },
      dev: {}
    },
    packageJson: {
      scripts: {
        "dev:app": "VITE_SURFACE=app vite",
        "dev:admin": "VITE_SURFACE=admin vite",
        "build:app": "VITE_SURFACE=app vite build",
        "build:admin": "VITE_SURFACE=admin vite build"
      }
    },
    procfile: {},
    files: [
      {
        from: "templates/packages/main/src/client/components/AccountPendingInvitesCue.vue",
        to: "packages/main/src/client/components/AccountPendingInvitesCue.vue",
        reason: "Install app-owned account pending invites cue component scaffold.",
        category: "workspaces-web",
        id: "users-web-main-component-account-pending-invites-cue"
      },
      {
        from: "templates/packages/main/src/client/components/AccountSettingsInvitesSection.vue",
        to: "packages/main/src/client/components/AccountSettingsInvitesSection.vue",
        reason: "Install app-owned account invites section scaffold for multihoming account settings.",
        category: "workspaces-web",
        id: "users-web-main-component-account-settings-invites-section"
      },
      {
        from: "templates/src/components/WorkspaceNotFoundCard.vue",
        to: "src/components/WorkspaceNotFoundCard.vue",
        reason: "Install app-owned workspace not-found card component used by workspace-dependent surfaces.",
        category: "workspaces-web",
        id: "users-web-component-workspace-not-found-card",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/src/composables/useWorkspaceNotFoundState.js",
        to: "src/composables/useWorkspaceNotFoundState.js",
        reason: "Install app-owned workspace bootstrap status composable for workspace-dependent surfaces.",
        category: "workspaces-web",
        id: "users-web-composable-workspace-not-found-state",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/src/surfaces/app/root.vue",
        toSurface: "app",
        toSurfaceRoot: true,
        reason: "Install workspace app surface wrapper shell for workspaces-web.",
        category: "workspaces-web",
        id: "users-web-page-app-wrapper",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/src/surfaces/app/index.vue",
        toSurface: "app",
        toSurfacePath: "index.vue",
        reason: "Install workspace app surface starter page scaffold for workspaces-web.",
        category: "workspaces-web",
        id: "users-web-page-app-index",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/src/surfaces/admin/root.vue",
        toSurface: "admin",
        toSurfaceRoot: true,
        reason: "Install workspace admin surface wrapper shell for workspaces-web.",
        category: "workspaces-web",
        id: "users-web-page-admin-wrapper",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/src/surfaces/admin/index.vue",
        toSurface: "admin",
        toSurfacePath: "index.vue",
        reason: "Install workspace admin surface starter page scaffold for workspaces-web.",
        category: "workspaces-web",
        id: "users-web-page-admin-index",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/src/pages/admin/members/index.vue",
        toSurface: "admin",
        toSurfacePath: "members/index.vue",
        reason: "Install admin members starter page scaffold for workspaces-web members UI.",
        category: "workspaces-web",
        id: "users-web-page-admin-members",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/src/pages/admin/workspace/settings.vue",
        toSurface: "admin",
        toSurfacePath: "workspace/settings.vue",
        reason: "Install workspace settings shell route scaffold for workspaces-web workspace admin UI.",
        category: "workspaces-web",
        id: "users-web-page-admin-workspace-settings-shell",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/src/pages/admin/workspace/settings/index.vue",
        toSurface: "admin",
        toSurfacePath: "workspace/settings/index.vue",
        reason: "Install workspace settings index stub scaffold for app-owned landing or redirect behavior.",
        category: "workspaces-web",
        id: "users-web-page-admin-workspace-settings",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      }
    ],
    text: [
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"workspaces.profile.menu.surface-switch\"",
        value:
          "\naddPlacement({\n  id: \"workspaces.profile.menu.surface-switch\",\n  target: \"auth.profile-menu\",\n  kind: \"component\",\n  surfaces: [\"*\"],\n  order: 100,\n  componentToken: \"workspaces.web.profile.menu.surface-switch-item\",\n  when: ({ auth }) => auth?.authenticated === true\n});\n",
        reason: "Append workspaces-web profile surface switch placement into app-owned placement registry.",
        category: "workspaces-web",
        id: "workspaces-web-profile-surface-switch-placement",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"workspaces.workspace.selector\"",
        value: "\naddPlacement({\n  id: \"workspaces.workspace.menu.app\",\n  target: \"shell.primary-nav\",\n  kind: \"link\",\n  surfaces: [\"app\"],\n  order: 50,\n  props: {\n    label: \"Home\",\n    surface: \"app\",\n    scopedSuffix: \"/\",\n    unscopedSuffix: \"/\",\n    exact: true\n  },\n  when: ({ auth }) => auth?.authenticated === true\n});\n\naddPlacement({\n  id: \"workspaces.workspace.menu.admin\",\n  target: \"shell.primary-nav\",\n  kind: \"link\",\n  surfaces: [\"admin\"],\n  order: 60,\n  props: {\n    label: \"Home\",\n    surface: \"admin\",\n    scopedSuffix: \"/\",\n    unscopedSuffix: \"/\",\n    exact: true\n  },\n  when: ({ auth }) => auth?.authenticated === true\n});\n\naddPlacement({\n  id: \"workspaces.workspace.selector\",\n  target: \"shell.identity\",\n  kind: \"component\",\n  surfaces: [\"*\"],\n  order: 200,\n  componentToken: \"workspaces.web.workspace.selector\",\n  props: {\n    allowOnNonWorkspaceSurface: true,\n    targetSurfaceId: \"app\"\n  },\n  when: ({ auth }) => auth?.authenticated === true\n});\n\naddPlacement({\n  id: \"workspaces.account.invites.cue\",\n  target: \"shell.status\",\n  kind: \"component\",\n  surfaces: [\"*\"],\n  order: 850,\n  componentToken: \"local.main.account.pending-invites.cue\",\n  when: ({ auth }) => auth?.authenticated === true\n});\n\naddPlacement({\n  id: \"workspaces.workspace.tools.widget\",\n  target: \"shell.status\",\n  kind: \"component\",\n  surfaces: [\"admin\"],\n  order: 900,\n  componentToken: \"workspaces.web.workspace.tools.widget\"\n});\n\naddPlacement({\n  id: \"workspaces.workspace.menu.workspace-settings\",\n  target: \"admin.tools-menu\",\n  kind: \"component\",\n  surfaces: [\"admin\"],\n  order: 100,\n  componentToken: \"workspaces.web.workspace-settings.menu-item\"\n});\n\naddPlacement({\n  id: \"workspaces.workspace.menu.members\",\n  target: \"admin.tools-menu\",\n  kind: \"component\",\n  surfaces: [\"admin\"],\n  order: 200,\n  componentToken: \"workspaces.web.workspace-members.menu-item\"\n});\n",
        reason: "Append workspace placement entries into app-owned placement registry.",
        category: "workspaces-web",
        id: "workspaces-web-placement-block",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        op: "append-text",
        file: "src/placementTopology.js",
        position: "bottom",
        skipIfContains: "id: \"admin.tools-menu\"",
        value: "\naddPlacementTopology({\n  id: \"page.section-nav\",\n  owner: \"admin-settings\",\n  description: \"Navigation between workspace admin settings child pages.\",\n  surfaces: [\"admin\"],\n  variants: {\n    compact: {\n      outlet: \"admin-settings:primary-menu\",\n      renderers: {\n        link: \"local.main.ui.surface-aware-menu-link-item\"\n      }\n    },\n    medium: {\n      outlet: \"admin-settings:primary-menu\",\n      renderers: {\n        link: \"local.main.ui.surface-aware-menu-link-item\"\n      }\n    },\n    expanded: {\n      outlet: \"admin-settings:primary-menu\",\n      renderers: {\n        link: \"local.main.ui.surface-aware-menu-link-item\"\n      }\n    }\n  }\n});\n\naddPlacementTopology({\n  id: \"admin.tools-menu\",\n  description: \"Admin surface tools menu actions.\",\n  surfaces: [\"admin\"],\n  variants: {\n    compact: {\n      outlet: \"admin-cog:primary-menu\",\n      renderers: {\n        link: \"local.main.ui.surface-aware-menu-link-item\"\n      }\n    },\n    medium: {\n      outlet: \"admin-cog:primary-menu\",\n      renderers: {\n        link: \"local.main.ui.surface-aware-menu-link-item\"\n      }\n    },\n    expanded: {\n      outlet: \"admin-cog:primary-menu\",\n      renderers: {\n        link: \"local.main.ui.surface-aware-menu-link-item\"\n      }\n    }\n  }\n});\n",
        reason: "Append workspaces-web admin semantic topology into app-owned placement topology.",
        category: "workspaces-web",
        id: "workspaces-web-admin-placement-topology",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"workspaces.account.settings.invites\"",
        value:
          "\naddPlacement({\n  id: \"workspaces.account.settings.invites\",\n  target: \"settings.sections\",\n  owner: \"account-settings\",\n  kind: \"component\",\n  surfaces: [\"account\"],\n  order: 400,\n  componentToken: \"local.main.account-settings.section.invites\",\n  props: {\n    title: \"Invites\",\n    value: \"invites\",\n    usesSharedRuntime: false\n  },\n  when: ({ auth, workspaceInvitesEnabled }) => auth?.authenticated === true && workspaceInvitesEnabled === true\n});\n",
        reason: "Append workspaces-web account settings invites section placement into app-owned placement registry.",
        category: "workspaces-web",
        id: "workspaces-web-account-settings-placement",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "top",
        skipIfContains: "import AccountPendingInvitesCue from \"../components/AccountPendingInvitesCue.vue\";",
        value: "import AccountPendingInvitesCue from \"../components/AccountPendingInvitesCue.vue\";\n",
        reason: "Bind app-owned account pending invites cue component into local main client provider imports.",
        category: "workspaces-web",
        id: "users-web-main-client-provider-account-invites-import"
      },
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "top",
        skipIfContains: "import AccountSettingsInvitesSection from \"../components/AccountSettingsInvitesSection.vue\";",
        value:
          "import AccountSettingsInvitesSection from \"../components/AccountSettingsInvitesSection.vue\";\n",
        reason: "Bind app-owned account invites section component into local main client provider imports.",
        category: "workspaces-web",
        id: "users-web-main-client-provider-account-settings-section-import"
      },
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "bottom",
        skipIfContains: "registerMainClientComponent(\"local.main.account.pending-invites.cue\", () => AccountPendingInvitesCue);",
        value:
          "\nregisterMainClientComponent(\"local.main.account.pending-invites.cue\", () => AccountPendingInvitesCue);\n",
        reason: "Bind app-owned account pending invites cue component token into local main client provider registry.",
        category: "workspaces-web",
        id: "users-web-main-client-provider-account-invites-register"
      },
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "bottom",
        skipIfContains:
          "registerMainClientComponent(\"local.main.account-settings.section.invites\", () => AccountSettingsInvitesSection);",
        value:
          "\nregisterMainClientComponent(\"local.main.account-settings.section.invites\", () => AccountSettingsInvitesSection);\n",
        reason: "Bind app-owned account invites section component token into local main client provider registry.",
        category: "workspaces-web",
        id: "users-web-main-client-provider-account-settings-section-register"
      }
    ]
  }
});
