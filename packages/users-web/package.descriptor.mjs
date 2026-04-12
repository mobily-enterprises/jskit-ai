export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/users-web",
  version: "0.1.48",
  kind: "runtime",
  description: "Users web module: account/profile UI plus shared shell link components.",
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
          subpath: "./client/components/ConsoleSettingsClientElement",
          summary: "Exports console settings landing-page client element."
        },
        {
          subpath: "./client/components/WorkspaceSettingsClientElement",
          summary: "Exports workspace settings client element."
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
      ],
      containerTokens: {
        server: [],
        client: [
          "users.web.shell.menu-link-item",
          "users.web.shell.surface-aware-menu-link-item",
          "users.web.profile.menu.surface-switch-item",
          "users.web.profile.element",
          "users.web.bootstrap-placement.runtime"
        ]
      }
    },
    ui: {
      placements: {
        outlets: [
          {
            host: "console-settings",
            position: "primary-menu",
            surfaces: ["console"],
            source: "templates/src/pages/console/settings.vue"
          }
        ],
        contributions: [
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
            id: "users.console.menu.settings",
            host: "shell-layout",
            position: "primary-menu",
            surfaces: ["console"],
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
        "@tanstack/vue-query": "5.92.12",
        "@mdi/js": "^7.4.47",
        "@jskit-ai/http-runtime": "0.1.32",
        "@jskit-ai/realtime": "0.1.32",
        "@jskit-ai/kernel": "0.1.33",
        "@jskit-ai/shell-web": "0.1.32",
        "@jskit-ai/uploads-image-web": "0.1.11",
        "@jskit-ai/users-core": "0.1.43",
        vuetify: "^4.0.0"
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
        from: "templates/src/pages/console/settings.vue",
        toSurface: "console",
        toSurfacePath: "settings.vue",
        reason: "Install console settings shell route scaffold for users-web console UI.",
        category: "users-web",
        id: "users-web-page-console-settings-shell"
      },
      {
        from: "templates/src/pages/console/settings/index.vue",
        toSurface: "console",
        toSurfacePath: "settings/index.vue",
        reason: "Install console settings landing page scaffold for users-web console UI.",
        category: "users-web",
        id: "users-web-page-console-settings"
      }
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
      }
    ]
  }
});
