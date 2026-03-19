export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/users-web",
  version: "0.1.0",
  description: "Users web module: workspace selector shell element plus workspace/profile/members UI elements.",
  dependsOn: [
    "@jskit-ai/http-runtime",
    "@jskit-ai/shell-web",
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
    client: {
      optimizeDeps: {
        include: [
          "@uppy/core",
          "@uppy/dashboard",
          "@uppy/image-editor",
          "@uppy/compressor",
          "@uppy/xhr-upload"
        ]
      }
    },
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
          "users.web.account-settings.element",
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
            slot: "workspace.primary-menu",
            surfaces: ["admin"],
            source: "src/client/components/UsersWorkspaceToolsWidget.vue"
          },
          {
            slot: "account.settings.forms",
            surfaces: ["*"],
            source: "templates/src/pages/account/settings/index.vue"
          },
          {
            slot: "workspace.settings.forms",
            surfaces: ["admin"],
            source: "templates/src/pages/admin/workspace/settings/index.vue"
          },
          {
            slot: "console.settings.forms",
            surfaces: ["console"],
            source: "templates/src/pages/console/settings/index.vue"
          }
        ],
        contributions: [
          {
            id: "users.workspace.selector",
            slot: "app.top-left",
            surface: "*",
            order: 200,
            componentToken: "users.web.workspace.selector",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-placement-block"
          },
          {
            id: "users.profile.menu.surface-switch",
            slot: "avatar.primary-menu",
            surface: "*",
            order: 100,
            componentToken: "users.web.profile.menu.surface-switch-item",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-profile-surface-switch-placement"
          },
          {
            id: "users.profile.menu.settings",
            slot: "avatar.primary-menu",
            surface: "*",
            order: 500,
            componentToken: "users.web.shell.menu-link-item",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-profile-settings-placement"
          },
          {
            id: "users.workspace.tools.widget",
            slot: "app.top-right",
            surface: "admin",
            order: 900,
            componentToken: "users.web.workspace.tools.widget",
            source: "mutations.text#users-web-placement-block"
          },
          {
            id: "users.workspace.menu.workspace-settings",
            slot: "workspace.primary-menu",
            surface: "admin",
            order: 100,
            componentToken: "users.web.workspace-settings.menu-item",
            source: "mutations.text#users-web-placement-block"
          },
          {
            id: "users.workspace.menu.members",
            slot: "workspace.primary-menu",
            surface: "admin",
            order: 200,
            componentToken: "users.web.workspace-members.menu-item",
            source: "mutations.text#users-web-placement-block"
          },
          {
            id: "users.console.menu.settings",
            slot: "app.primary-menu",
            surface: "console",
            order: 100,
            componentToken: "users.web.shell.menu-link-item",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-console-settings-placement"
          },
          {
            id: "users.account.settings.form",
            slot: "account.settings.forms",
            surface: "*",
            order: 100,
            componentToken: "users.web.account-settings.element",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-account-settings-form-placement"
          },
          {
            id: "users.workspace.settings.form",
            slot: "workspace.settings.forms",
            surface: "admin",
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
        "@tanstack/vue-query": "^5.90.5",
        "@mdi/js": "^7.4.47",
        "@uppy/compressor": "^3.1.0",
        "@uppy/core": "^5.2.0",
        "@uppy/dashboard": "^5.1.1",
        "@uppy/image-editor": "^4.2.0",
        "@uppy/xhr-upload": "^5.1.1",
        "@jskit-ai/http-runtime": "0.1.0",
        "@jskit-ai/realtime": "0.1.0",
        "@jskit-ai/kernel": "0.1.0",
        "@jskit-ai/shell-web": "0.1.0",
        "@jskit-ai/users-core": "0.1.0",
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
        from: "templates/src/pages/account/settings/index.vue",
        to: "src/pages/account/settings/index.vue",
        reason: "Install app-owned account settings page scaffold for users-web profile/settings UI.",
        category: "users-web",
        id: "users-web-page-account-settings"
      },
      {
        from: "templates/src/pages/admin/members/index.vue",
        to: "src/pages/admin/members/index.vue",
        reason: "Install admin members starter page scaffold for users-web members UI.",
        category: "users-web",
        id: "users-web-page-admin-members",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspace"]
        }
      },
      {
        from: "templates/src/pages/admin/workspace/settings/index.vue",
        to: "src/pages/admin/workspace/settings/index.vue",
        reason: "Install workspace settings page scaffold for users-web workspace admin UI.",
        category: "users-web",
        id: "users-web-page-admin-workspace-settings",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspace"]
        }
      },
      {
        from: "templates/src/pages/console/settings/index.vue",
        to: "src/pages/console/settings/index.vue",
        reason: "Install console settings page scaffold for users-web console UI.",
        category: "users-web",
        id: "users-web-page-console-settings"
      },
      {
        from: "templates/src/pages/workspaces/index.vue",
        to: "src/pages/workspaces/index.vue",
        reason: "Install workspace chooser and invitation acceptance page scaffold for users-web workspace UI.",
        category: "users-web",
        id: "users-web-page-workspaces",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspace"]
        }
      }
    ],
    text: [
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"users.workspace.selector\"",
        value: "\naddPlacement({\n  id: \"users.workspace.selector\",\n  slot: \"app.top-left\",\n  surface: \"*\",\n  order: 200,\n  componentToken: \"users.web.workspace.selector\",\n  props: {\n    allowOnNonWorkspaceSurface: true,\n    targetSurfaceId: \"app\"\n  },\n  when: ({ auth }) => {\n    return Boolean(auth?.authenticated);\n  }\n});\n\naddPlacement({\n  id: \"users.workspace.tools.widget\",\n  slot: \"app.top-right\",\n  surface: \"admin\",\n  order: 900,\n  componentToken: \"users.web.workspace.tools.widget\"\n});\n\naddPlacement({\n  id: \"users.workspace.menu.workspace-settings\",\n  slot: \"workspace.primary-menu\",\n  surface: \"admin\",\n  order: 100,\n  componentToken: \"users.web.workspace-settings.menu-item\"\n});\n\naddPlacement({\n  id: \"users.workspace.menu.members\",\n  slot: \"workspace.primary-menu\",\n  surface: \"admin\",\n  order: 200,\n  componentToken: \"users.web.workspace-members.menu-item\"\n});\n",
        reason: "Append users-web placement entries into app-owned placement registry.",
        category: "users-web",
        id: "users-web-placement-block",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspace"]
        }
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"users.profile.menu.surface-switch\"",
        value:
          "\naddPlacement({\n  id: \"users.profile.menu.surface-switch\",\n  slot: \"avatar.primary-menu\",\n  surface: \"*\",\n  order: 100,\n  componentToken: \"users.web.profile.menu.surface-switch-item\",\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
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
          "\naddPlacement({\n  id: \"users.profile.menu.settings\",\n  slot: \"avatar.primary-menu\",\n  surface: \"*\",\n  order: 500,\n  componentToken: \"users.web.shell.menu-link-item\",\n  props: {\n    label: \"Settings\",\n    to: \"/account/settings\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
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
          "\naddPlacement({\n  id: \"users.console.menu.settings\",\n  slot: \"app.primary-menu\",\n  surface: \"console\",\n  order: 100,\n  componentToken: \"users.web.shell.menu-link-item\",\n  props: {\n    label: \"Settings\",\n    to: \"/console/settings\",\n    icon: \"mdi-cog-outline\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append users-web console settings menu placement into app-owned placement registry.",
        category: "users-web",
        id: "users-web-console-settings-placement"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"users.account.settings.form\"",
        value:
          "\naddPlacement({\n  id: \"users.account.settings.form\",\n  slot: \"account.settings.forms\",\n  surface: \"*\",\n  order: 100,\n  componentToken: \"users.web.account-settings.element\",\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append users-web account settings form placement into app-owned placement registry.",
        category: "users-web",
        id: "users-web-account-settings-form-placement"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"users.workspace.settings.form\"",
        value:
          "\naddPlacement({\n  id: \"users.workspace.settings.form\",\n  slot: \"workspace.settings.forms\",\n  surface: \"admin\",\n  order: 100,\n  componentToken: \"users.web.workspace-settings.element\"\n});\n",
        reason: "Append users-web workspace settings form placement into app-owned placement registry.",
        category: "users-web",
        id: "users-web-workspace-settings-form-placement",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspace"]
        }
      }
    ]
  }
});
