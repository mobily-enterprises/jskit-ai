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
            "Exports users web client provider, workspace selector shell components, and profile/workspace settings/members UI elements."
        }
      ],
      containerTokens: {
        server: [],
        client: [
          "users.web.workspace.selector",
          "users.web.shell.menu-link-item",
          "users.web.workspace-settings.menu-item",
          "users.web.profile.element",
          "users.web.members-admin.element",
          "users.web.workspace-settings.element"
        ]
      }
    },
    ui: {
      placements: {
        outlets: [],
        contributions: [
          {
            id: "users.workspace.selector.app",
            slot: "app.top-left",
            surface: "app",
            order: 200,
            componentToken: "users.web.workspace.selector",
            source: "mutations.text#users-web-placement-block"
          },
          {
            id: "users.workspace.selector.admin",
            slot: "app.top-left",
            surface: "admin",
            order: 200,
            componentToken: "users.web.workspace.selector",
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
            id: "users.admin.menu.workspace-settings",
            slot: "app.primary-menu",
            surface: "admin",
            order: 410,
            componentToken: "users.web.workspace-settings.menu-item",
            source: "mutations.text#users-web-placement-block"
          },
          {
            id: "users.admin.menu.members",
            slot: "app.primary-menu",
            surface: "admin",
            order: 420,
            componentToken: "users.web.shell.menu-link-item",
            source: "mutations.text#users-web-placement-block"
          }
        ]
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
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
        from: "templates/src/pages/app/settings/index.vue",
        to: "src/pages/app/settings/index.vue",
        reason: "Install app settings starter page scaffold for users-web profile/settings UI.",
        category: "users-web",
        id: "users-web-page-app-settings"
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
      }
    ],
    text: [
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"users.workspace.selector.app\"",
        value: "\naddPlacement({\n  id: \"users.workspace.selector.app\",\n  slot: \"app.top-left\",\n  surface: \"app\",\n  order: 200,\n  componentToken: \"users.web.workspace.selector\"\n});\n\naddPlacement({\n  id: \"users.workspace.selector.admin\",\n  slot: \"app.top-left\",\n  surface: \"admin\",\n  order: 200,\n  componentToken: \"users.web.workspace.selector\"\n});\n\naddPlacement({\n  id: \"users.profile.menu.settings\",\n  slot: \"avatar.primary-menu\",\n  surface: \"*\",\n  order: 500,\n  componentToken: \"users.web.shell.menu-link-item\",\n  props: {\n    label: \"Settings\",\n    to: \"/app/settings\",\n    icon: \"$menuSettings\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n\naddPlacement({\n  id: \"users.admin.menu.workspace-settings\",\n  slot: \"app.primary-menu\",\n  surface: \"admin\",\n  order: 410,\n  componentToken: \"users.web.workspace-settings.menu-item\"\n});\n\naddPlacement({\n  id: \"users.admin.menu.members\",\n  slot: \"app.primary-menu\",\n  surface: \"admin\",\n  order: 420,\n  componentToken: \"users.web.shell.menu-link-item\",\n  props: {\n    label: \"Members\",\n    to: \"/admin/members\",\n    icon: \"$consoleMembers\"\n  }\n});\n",
        reason: "Append users-web placement entries into app-owned placement registry.",
        category: "users-web",
        id: "users-web-placement-block"
      }
    ]
  }
});
