export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/users-web",
  version: "0.1.38",
  kind: "runtime",
  description: "Users web module: workspace selector shell element plus workspace/profile/members UI elements.",
  dependsOn: [
    "@jskit-ai/http-runtime",
    "@jskit-ai/shell-web",
    "@jskit-ai/uploads-image-web",
    "@jskit-ai/users-core"
  ],
  capabilities: {
    provides: [
      "users.web"
    ],
    requires: [
      "runtime.web-placement",
      "users.server-routes"
    ]
  },
  runtime: {
    server: {
      providers: []
    },
    client: {
      providers: [
        {
          entrypoint: "src/client/providers/UsersWebClientProvider.js",
          export: "UsersWebClientProvider"
        }
      ]
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./client",
          summary: "Exports users-web client provider registration surface."
        },
        {
          subpath: "./client/providers/UsersWebClientProvider",
          summary: "Exports users-web client provider class."
        },
        {
          subpath: "./client/components/ProfileClientElement",
          summary: "Exports profile settings client element scaffold component."
        },
        {
          subpath: "./client/components/WorkspacesClientElement",
          summary: "Exports workspace chooser client element component."
        },
        {
          subpath: "./client/components/WorkspaceMembersClientElement",
          summary: "Exports workspace members admin client element component."
        },
        {
          subpath: "./client/composables/useAddEdit",
          summary: "Exports add/edit operation composable."
        },
        {
          subpath: "./client/composables/useList",
          summary: "Exports list operation composable."
        },
        {
          subpath: "./client/composables/crudLookupFieldRuntime",
          summary: "Exports CRUD lookup field runtime helpers for generated add/edit forms."
        },
        {
          subpath: "./client/composables/useCommand",
          summary: "Exports command operation composable."
        },
        {
          subpath: "./client/composables/useView",
          summary: "Exports read/view operation composable."
        },
        {
          subpath: "./client/composables/usePagedCollection",
          summary: "Exports paged collection query composable."
        },
        {
          subpath: "./client/composables/usePaths",
          summary: "Exports surface/workspace path resolver composable."
        },
        {
          subpath: "./client/composables/useAccountSettingsRuntime",
          summary: "Exports account settings runtime composable for app-owned settings UI."
        },
        {
          subpath: "./client/composables/useWorkspaceRouteContext",
          summary: "Exports workspace route context composable."
        },
        {
          subpath: "./client/support/realtimeWorkspace",
          summary: "Exports workspace realtime event helpers."
        }
      ],
      containerTokens: {
        server: [],
        client: [
          "users.web.workspace.selector",
          "users.web.workspace.tools.widget",
          "users.web.shell.menu-link-item",
          "users.web.shell.surface-aware-menu-link-item",
          "users.web.profile.menu.surface-switch-item",
          "users.web.workspace-settings.menu-item",
          "users.web.workspace-members.menu-item",
          "users.web.profile.element",
          "users.web.members-admin.element",
          "users.web.workspace-settings.element",
          "users.web.bootstrap-placement.runtime"
        ]
      }
    },
    ui: {
      placements: {
        outlets: [
          {
            host: "workspace-tools",
            position: "primary-menu",
            surfaces: ["admin"],
            source: "src/client/components/UsersWorkspaceToolsWidget.vue"
          },
          {
            host: "workspace-settings",
            position: "forms",
            surfaces: ["admin"],
            source: "templates/src/pages/admin/workspace/settings/index.vue"
          },
          {
            host: "console-settings",
            position: "forms",
            surfaces: ["console"],
            source: "templates/src/pages/console/settings/index.vue"
          }
        ],
        contributions: [
          {
            id: "users.workspace.selector",
            host: "shell-layout",
            position: "top-left",
            surfaces: ["*"],
            order: 200,
            componentToken: "users.web.workspace.selector",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-placement-block"
          },
          {
            id: "users.account.invites.cue",
            host: "shell-layout",
            position: "top-right",
            surfaces: ["*"],
            order: 850,
            componentToken: "local.main.account.pending-invites.cue",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-placement-block"
          },
          {
            id: "users.profile.menu.surface-switch",
            host: "auth-profile-menu",
            position: "primary-menu",
            surfaces: ["*"],
            order: 100,
            componentToken: "users.web.profile.menu.surface-switch-item",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-profile-surface-switch-placement"
          },
          {
            id: "users.profile.menu.settings",
            host: "auth-profile-menu",
            position: "primary-menu",
            surfaces: ["*"],
            order: 500,
            componentToken: "users.web.shell.menu-link-item",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-profile-settings-placement"
          },
          {
            id: "users.workspace.tools.widget",
            host: "shell-layout",
            position: "top-right",
            surfaces: ["admin"],
            order: 900,
            componentToken: "users.web.workspace.tools.widget",
            source: "mutations.text#users-web-placement-block"
          },
          {
            id: "users.workspace.menu.workspace-settings",
            host: "workspace-tools",
            position: "primary-menu",
            surfaces: ["admin"],
            order: 100,
            componentToken: "users.web.workspace-settings.menu-item",
            source: "mutations.text#users-web-placement-block"
          },
          {
            id: "users.workspace.menu.members",
            host: "workspace-tools",
            position: "primary-menu",
            surfaces: ["admin"],
            order: 200,
            componentToken: "users.web.workspace-members.menu-item",
            source: "mutations.text#users-web-placement-block"
          },
          {
            id: "users.console.menu.settings",
            host: "shell-layout",
            position: "primary-menu",
            surfaces: ["console"],
            order: 100,
            componentToken: "users.web.shell.menu-link-item",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-console-settings-placement"
          },
          {
            id: "users.workspace.settings.form",
            host: "workspace-settings",
            position: "forms",
            surfaces: ["admin"],
            order: 100,
            componentToken: "users.web.workspace-settings.element",
            source: "mutations.text#users-web-workspace-settings-form-placement"
          }
        ]
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@tanstack/vue-query": "5.92.12",
        "@mdi/js": "^7.4.47",
        "@jskit-ai/http-runtime": "0.1.23",
        "@jskit-ai/realtime": "0.1.23",
        "@jskit-ai/kernel": "0.1.24",
        "@jskit-ai/shell-web": "0.1.23",
        "@jskit-ai/uploads-image-web": "0.1.2",
        "@jskit-ai/users-core": "0.1.33",
        "vuetify": "^4.0.0"
      },
      dev: {}
    },
    packageJson: {
      scripts: {
        "server:account": "SERVER_SURFACE=account node ./bin/server.js",
        "dev:account": "VITE_SURFACE=account vite",
        "build:account": "VITE_SURFACE=account vite build"
      }
    },
    procfile: {},
    files: [
      {
        from: "templates/src/pages/account/index.vue",
        to: "src/pages/account/index.vue",
        reason: "Install app-owned account surface root page scaffold.",
        category: "users-web",
        id: "users-web-page-account-root"
      },
      {
        from: "templates/src/components/account/settings/AccountSettingsClientElement.vue",
        to: "src/components/account/settings/AccountSettingsClientElement.vue",
        reason: "Install app-owned account settings container component scaffold.",
        category: "users-web",
        id: "users-web-component-account-settings-root"
      },
      {
        from: "templates/src/components/account/settings/AccountSettingsProfileSection.vue",
        to: "src/components/account/settings/AccountSettingsProfileSection.vue",
        reason: "Install app-owned account settings profile section scaffold.",
        category: "users-web",
        id: "users-web-component-account-settings-profile"
      },
      {
        from: "templates/src/components/account/settings/AccountSettingsPreferencesSection.vue",
        to: "src/components/account/settings/AccountSettingsPreferencesSection.vue",
        reason: "Install app-owned account settings preferences section scaffold.",
        category: "users-web",
        id: "users-web-component-account-settings-preferences"
      },
      {
        from: "templates/src/components/account/settings/AccountSettingsNotificationsSection.vue",
        to: "src/components/account/settings/AccountSettingsNotificationsSection.vue",
        reason: "Install app-owned account settings notifications section scaffold.",
        category: "users-web",
        id: "users-web-component-account-settings-notifications"
      },
      {
        from: "templates/src/components/account/settings/AccountSettingsInvitesSection.vue",
        to: "src/components/account/settings/AccountSettingsInvitesSection.vue",
        reason: "Install app-owned account settings invites section scaffold.",
        category: "users-web",
        id: "users-web-component-account-settings-invites"
      },
      {
        from: "templates/packages/main/src/client/components/AccountPendingInvitesCue.vue",
        to: "packages/main/src/client/components/AccountPendingInvitesCue.vue",
        reason: "Install app-owned account pending invites cue component scaffold.",
        category: "users-web",
        id: "users-web-main-component-account-pending-invites-cue"
      },
      {
        from: "templates/src/components/WorkspaceNotFoundCard.vue",
        to: "src/components/WorkspaceNotFoundCard.vue",
        reason: "Install app-owned workspace not-found card component used by workspace-dependent surfaces.",
        category: "users-web",
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
        category: "users-web",
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
        reason: "Install workspace app surface wrapper shell for users-web.",
        category: "users-web",
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
        reason: "Install workspace app surface starter page scaffold for users-web.",
        category: "users-web",
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
        reason: "Install workspace admin surface wrapper shell for users-web.",
        category: "users-web",
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
        reason: "Install workspace admin surface starter page scaffold for users-web.",
        category: "users-web",
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
        reason: "Install admin members starter page scaffold for users-web members UI.",
        category: "users-web",
        id: "users-web-page-admin-members",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/src/pages/admin/workspace/settings/index.vue",
        toSurface: "admin",
        toSurfacePath: "workspace/settings/index.vue",
        reason: "Install workspace settings page scaffold for users-web workspace admin UI.",
        category: "users-web",
        id: "users-web-page-admin-workspace-settings",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/src/pages/console/settings/index.vue",
        toSurface: "console",
        toSurfacePath: "settings/index.vue",
        reason: "Install console settings page scaffold for users-web console UI.",
        category: "users-web",
        id: "users-web-page-console-settings"
      },
    ],
    text: [
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.surfaceDefinitions.account = {",
        value:
          "\nconfig.surfaceDefinitions.account = {\n  id: \"account\",\n  label: \"Account\",\n  pagesRoot: \"account\",\n  enabled: true,\n  requiresAuth: true,\n  requiresWorkspace: false,\n  origin: \"\"\n};\n",
        reason: "Register account surface definition in public surface config.",
        category: "users-web",
        id: "users-web-surface-config-account"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"users.workspace.selector\"",
        value: "\naddPlacement({\n  id: \"users.workspace.selector\",\n  host: \"shell-layout\",\n  position: \"top-left\",\n  surfaces: [\"*\"],\n  order: 200,\n  componentToken: \"users.web.workspace.selector\",\n  props: {\n    allowOnNonWorkspaceSurface: true,\n    targetSurfaceId: \"app\"\n  },\n  when: ({ auth }) => {\n    return Boolean(auth?.authenticated);\n  }\n});\n\naddPlacement({\n  id: \"users.account.invites.cue\",\n  host: \"shell-layout\",\n  position: \"top-right\",\n  surfaces: [\"*\"],\n  order: 850,\n  componentToken: \"local.main.account.pending-invites.cue\",\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n\naddPlacement({\n  id: \"users.workspace.tools.widget\",\n  host: \"shell-layout\",\n  position: \"top-right\",\n  surfaces: [\"admin\"],\n  order: 900,\n  componentToken: \"users.web.workspace.tools.widget\"\n});\n\naddPlacement({\n  id: \"users.workspace.menu.workspace-settings\",\n  host: \"workspace-tools\",\n  position: \"primary-menu\",\n  surfaces: [\"admin\"],\n  order: 100,\n  componentToken: \"users.web.workspace-settings.menu-item\"\n});\n\naddPlacement({\n  id: \"users.workspace.menu.members\",\n  host: \"workspace-tools\",\n  position: \"primary-menu\",\n  surfaces: [\"admin\"],\n  order: 200,\n  componentToken: \"users.web.workspace-members.menu-item\"\n});\n",
        reason: "Append users-web placement entries into app-owned placement registry.",
        category: "users-web",
        id: "users-web-placement-block",
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
        category: "users-web",
        id: "users-web-main-client-provider-account-invites-import"
      },
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "bottom",
        skipIfContains: "registerMainClientComponent(\"local.main.account.pending-invites.cue\", () => AccountPendingInvitesCue);",
        value:
          "\nregisterMainClientComponent(\"local.main.account.pending-invites.cue\", () => AccountPendingInvitesCue);\n",
        reason: "Bind app-owned account pending invites cue component token into local main client provider registry.",
        category: "users-web",
        id: "users-web-main-client-provider-account-invites-register"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"users.profile.menu.surface-switch\"",
        value:
          "\naddPlacement({\n  id: \"users.profile.menu.surface-switch\",\n  host: \"auth-profile-menu\",\n  position: \"primary-menu\",\n  surfaces: [\"*\"],\n  order: 100,\n  componentToken: \"users.web.profile.menu.surface-switch-item\",\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append users-web profile surface switch placement into app-owned placement registry.",
        category: "users-web",
        id: "users-web-profile-surface-switch-placement"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"users.profile.menu.settings\"",
        value:
          "\naddPlacement({\n  id: \"users.profile.menu.settings\",\n  host: \"auth-profile-menu\",\n  position: \"primary-menu\",\n  surfaces: [\"*\"],\n  order: 500,\n  componentToken: \"users.web.shell.menu-link-item\",\n  props: {\n    label: \"Settings\",\n    to: \"/account\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append users-web profile settings menu placement into app-owned placement registry.",
        category: "users-web",
        id: "users-web-profile-settings-placement"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"users.console.menu.settings\"",
        value:
          "\naddPlacement({\n  id: \"users.console.menu.settings\",\n  host: \"shell-layout\",\n  position: \"primary-menu\",\n  surfaces: [\"console\"],\n  order: 100,\n  componentToken: \"users.web.shell.menu-link-item\",\n  props: {\n    label: \"Settings\",\n    to: \"/console/settings\",\n    icon: \"mdi-cog-outline\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append users-web console settings menu placement into app-owned placement registry.",
        category: "users-web",
        id: "users-web-console-settings-placement"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"users.workspace.settings.form\"",
        value:
          "\naddPlacement({\n  id: \"users.workspace.settings.form\",\n  host: \"workspace-settings\",\n  position: \"forms\",\n  surfaces: [\"admin\"],\n  order: 100,\n  componentToken: \"users.web.workspace-settings.element\"\n});\n",
        reason: "Append users-web workspace settings form placement into app-owned placement registry.",
        category: "users-web",
        id: "users-web-workspace-settings-form-placement",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      }
    ]
  }
});
