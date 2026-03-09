export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/users-web",
  version: "0.1.0",
  description: "Users web module: workspace selector shell element plus workspace/profile/members UI elements.",
  dependsOn: [
    "@jskit-ai/http-runtime",
    "@jskit-ai/shell-web",
    "@jskit-ai/users-routes"
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
          summary:
            "Exports users web client provider, workspace selector/tools shell components, and profile/workspace settings/members UI elements."
        }
      ],
      containerTokens: {
        server: [],
        client: [
          "users.web.workspace.selector",
          "users.web.workspace.tools.widget",
          "users.web.shell.menu-link-item",
          "users.web.workspace-settings.menu-item",
          "users.web.workspace-members.menu-item",
          "users.web.profile.element",
          "users.web.members-admin.element",
          "users.web.workspace-settings.element"
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
            id: "users.profile.menu.settings",
            slot: "avatar.primary-menu",
            surface: "*",
            order: 500,
            componentToken: "users.web.shell.menu-link-item",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-placement-block"
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
          }
        ]
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@mdi/js": "^7.4.47",
        "@uppy/compressor": "^3.1.0",
        "@uppy/core": "^5.2.0",
        "@uppy/dashboard": "^5.1.1",
        "@uppy/image-editor": "^4.2.0",
        "@uppy/xhr-upload": "^5.1.1",
        "@jskit-ai/http-runtime": "0.1.0",
        "@jskit-ai/kernel": "0.1.0",
        "@jskit-ai/shell-web": "0.1.0",
        "@jskit-ai/users-routes": "0.1.0",
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
        id: "users-web-page-admin-members"
      },
      {
        from: "templates/src/pages/admin/workspace/settings/index.vue",
        to: "src/pages/admin/workspace/settings/index.vue",
        reason: "Install workspace settings page scaffold for users-web workspace admin UI.",
        category: "users-web",
        id: "users-web-page-admin-workspace-settings"
      },
      {
        from: "templates/src/pages/console/settings/index.vue",
        to: "src/pages/console/settings/index.vue",
        reason: "Install console settings page scaffold for users-web console UI.",
        category: "users-web",
        id: "users-web-page-console-settings"
      }
    ],
    text: [
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"users.workspace.selector\"",
        value: "\naddPlacement({\n  id: \"users.workspace.selector\",\n  slot: \"app.top-left\",\n  surface: \"*\",\n  order: 200,\n  componentToken: \"users.web.workspace.selector\",\n  props: {\n    allowOnNonWorkspaceSurface: true,\n    targetSurfaceId: \"app\"\n  },\n  when: ({ auth }) => {\n    return Boolean(auth?.authenticated);\n  }\n});\n\naddPlacement({\n  id: \"users.profile.menu.settings\",\n  slot: \"avatar.primary-menu\",\n  surface: \"*\",\n  order: 500,\n  componentToken: \"users.web.shell.menu-link-item\",\n  props: {\n    label: \"Settings\",\n    to: \"/account/settings\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n\naddPlacement({\n  id: \"users.workspace.tools.widget\",\n  slot: \"app.top-right\",\n  surface: \"admin\",\n  order: 900,\n  componentToken: \"users.web.workspace.tools.widget\"\n});\n\naddPlacement({\n  id: \"users.workspace.menu.workspace-settings\",\n  slot: \"workspace.primary-menu\",\n  surface: \"admin\",\n  order: 100,\n  componentToken: \"users.web.workspace-settings.menu-item\"\n});\n\naddPlacement({\n  id: \"users.workspace.menu.members\",\n  slot: \"workspace.primary-menu\",\n  surface: \"admin\",\n  order: 200,\n  componentToken: \"users.web.workspace-members.menu-item\"\n});\n",
        reason: "Append users-web placement entries into app-owned placement registry.",
        category: "users-web",
        id: "users-web-placement-block"
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
      }
    ]
  }
});
