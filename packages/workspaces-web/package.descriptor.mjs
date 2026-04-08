export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/workspaces-web",
  version: "0.1.0",
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
          subpath: "./client/providers/WorkspacesWebClientProvider",
          summary: "Exports workspaces-web client provider class."
        }
      ],
      containerTokens: {
        server: [],
        client: [
          "users.web.workspace.selector",
          "users.web.workspace.tools.widget",
          "users.web.workspace-settings.menu-item",
          "users.web.workspace-members.menu-item",
          "users.web.members-admin.element",
          "users.web.workspace-settings.element"
        ]
      }
    },
    ui: {
      placements: {
        outlets: [
          {
            host: "admin-settings",
            position: "primary-menu",
            surfaces: ["admin"],
            source: "templates/src/pages/admin/workspace/settings/index.vue"
          },
          {
            host: "admin-settings",
            position: "forms",
            surfaces: ["admin"],
            source: "templates/src/pages/admin/workspace/settings/index.vue"
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
            id: "users.workspace.settings.form",
            host: "admin-settings",
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
        "@jskit-ai/workspaces-core": "0.1.0",
        "@jskit-ai/users-web": "0.1.39"
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
        from: "templates/src/pages/admin/workspace/settings/index.vue",
        toSurface: "admin",
        toSurfacePath: "workspace/settings/index.vue",
        reason: "Install workspace settings page scaffold for workspaces-web workspace admin UI.",
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
        skipIfContains: "id: \"users.workspace.selector\"",
        value: "\naddPlacement({\n  id: \"users.workspace.selector\",\n  host: \"shell-layout\",\n  position: \"top-left\",\n  surfaces: [\"*\"],\n  order: 200,\n  componentToken: \"users.web.workspace.selector\",\n  props: {\n    allowOnNonWorkspaceSurface: true,\n    targetSurfaceId: \"app\"\n  },\n  when: ({ auth }) => {\n    return Boolean(auth?.authenticated);\n  }\n});\n\naddPlacement({\n  id: \"users.account.invites.cue\",\n  host: \"shell-layout\",\n  position: \"top-right\",\n  surfaces: [\"*\"],\n  order: 850,\n  componentToken: \"local.main.account.pending-invites.cue\",\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n\naddPlacement({\n  id: \"users.workspace.tools.widget\",\n  host: \"shell-layout\",\n  position: \"top-right\",\n  surfaces: [\"admin\"],\n  order: 900,\n  componentToken: \"users.web.workspace.tools.widget\"\n});\n\naddPlacement({\n  id: \"users.workspace.menu.workspace-settings\",\n  host: \"workspace-tools\",\n  position: \"primary-menu\",\n  surfaces: [\"admin\"],\n  order: 100,\n  componentToken: \"users.web.workspace-settings.menu-item\"\n});\n\naddPlacement({\n  id: \"users.workspace.menu.members\",\n  host: \"workspace-tools\",\n  position: \"primary-menu\",\n  surfaces: [\"admin\"],\n  order: 200,\n  componentToken: \"users.web.workspace-members.menu-item\"\n});\n",
        reason: "Append workspace placement entries into app-owned placement registry.",
        category: "workspaces-web",
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
        category: "workspaces-web",
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
        category: "workspaces-web",
        id: "users-web-main-client-provider-account-invites-register"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"users.workspace.settings.form\"",
        value:
          "\naddPlacement({\n  id: \"users.workspace.settings.form\",\n  host: \"admin-settings\",\n  position: \"forms\",\n  surfaces: [\"admin\"],\n  order: 100,\n  componentToken: \"users.web.workspace-settings.element\"\n});\n",
        reason: "Append workspace settings form placement into app-owned placement registry.",
        category: "workspaces-web",
        id: "users-web-workspace-settings-form-placement",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      }
    ]
  }
});
