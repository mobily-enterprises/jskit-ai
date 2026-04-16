import {
  HOME_TOOLS_OUTLET,
  WORKSPACE_TOOLS_OUTLET
} from "./src/shared/toolsOutletContracts.js";

export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/users-web",
  version: "0.1.52",
  kind: "runtime",
  description: "Users web module: account/profile UI plus shared users web widgets.",
  dependsOn: [
    "@jskit-ai/auth-web",
    "@jskit-ai/console-web",
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
          "users.web.profile.menu.surface-switch-item",
          "users.web.home.tools.widget",
          "users.web.profile.element",
          "users.web.bootstrap-placement.runtime"
        ]
      }
    },
    ui: {
      placements: {
        outlets: [
          {
            target: HOME_TOOLS_OUTLET.target,
            defaultLinkComponentToken: HOME_TOOLS_OUTLET.defaultLinkComponentToken,
            surfaces: ["home"],
            source: "src/client/components/UsersHomeToolsWidget.vue"
          },
          {
            target: WORKSPACE_TOOLS_OUTLET.target,
            defaultLinkComponentToken: WORKSPACE_TOOLS_OUTLET.defaultLinkComponentToken,
            surfaces: ["admin"],
            source: "src/client/components/UsersWorkspaceToolsWidget.vue"
          },
          {
            target: "console-settings:primary-menu",
            defaultLinkComponentToken: "local.main.ui.surface-aware-menu-link-item",
            surfaces: ["console"],
            source: "templates/src/pages/console/settings.vue"
          }
        ],
        contributions: [
          {
            id: "users.profile.menu.surface-switch",
            target: "auth-profile-menu:primary-menu",
            surfaces: ["*"],
            order: 100,
            componentToken: "users.web.profile.menu.surface-switch-item",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-profile-surface-switch-placement"
          },
          {
            id: "users.profile.menu.settings",
            target: "auth-profile-menu:primary-menu",
            surfaces: ["*"],
            order: 500,
            componentToken: "auth.web.profile.menu.link-item",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-profile-settings-placement"
          },
          {
            id: "users.console.menu.settings",
            target: "shell-layout:primary-menu",
            surfaces: ["console"],
            order: 100,
            componentToken: "local.main.ui.menu-link-item",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-console-settings-placement"
          },
          {
            id: "users.home.tools.widget",
            target: "shell-layout:top-right",
            surfaces: ["home"],
            order: 900,
            componentToken: "users.web.home.tools.widget",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-home-tools-placement"
          },
          {
            id: "users.home.menu.settings",
            target: "home-tools:primary-menu",
            surfaces: ["home"],
            order: 100,
            componentToken: "local.main.ui.surface-aware-menu-link-item",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-home-tools-placement"
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
        "@jskit-ai/console-web": "0.1.4",
        "@jskit-ai/http-runtime": "0.1.36",
        "@jskit-ai/realtime": "0.1.36",
        "@jskit-ai/kernel": "0.1.37",
        "@jskit-ai/shell-web": "0.1.36",
        "@jskit-ai/uploads-image-web": "0.1.15",
        "@jskit-ai/users-core": "0.1.47",
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
        reason: "Install console settings index stub scaffold for app-owned landing or redirect behavior.",
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
          "\naddPlacement({\n  id: \"users.profile.menu.surface-switch\",\n  target: \"auth-profile-menu:primary-menu\",\n  surfaces: [\"*\"],\n  order: 100,\n  componentToken: \"users.web.profile.menu.surface-switch-item\",\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
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
          "\naddPlacement({\n  id: \"users.profile.menu.settings\",\n  target: \"auth-profile-menu:primary-menu\",\n  surfaces: [\"*\"],\n  order: 500,\n  componentToken: \"auth.web.profile.menu.link-item\",\n  props: {\n    label: \"Settings\",\n    to: \"/account\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
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
          "\naddPlacement({\n  id: \"users.console.menu.settings\",\n  target: \"shell-layout:primary-menu\",\n  surfaces: [\"console\"],\n  order: 100,\n  componentToken: \"local.main.ui.menu-link-item\",\n  props: {\n    label: \"Settings\",\n    to: \"/console/settings\",\n    icon: \"mdi-cog-outline\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append users-web console settings menu placement into app-owned placement registry.",
        category: "users-web",
        id: "users-web-console-settings-placement"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"users.home.tools.widget\"",
        value:
          "\naddPlacement({\n  id: \"users.home.tools.widget\",\n  target: \"shell-layout:top-right\",\n  surfaces: [\"home\"],\n  order: 900,\n  componentToken: \"users.web.home.tools.widget\",\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n\naddPlacement({\n  id: \"users.home.menu.settings\",\n  target: \"home-tools:primary-menu\",\n  surfaces: [\"home\"],\n  order: 100,\n  componentToken: \"local.main.ui.surface-aware-menu-link-item\",\n  props: {\n    label: \"Settings\",\n    surface: \"home\",\n    workspaceSuffix: \"/settings\",\n    nonWorkspaceSuffix: \"/settings\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append users-web home tools widget and settings menu placements into app-owned placement registry.",
        category: "users-web",
        id: "users-web-home-tools-placement"
      }
    ]
  }
});
