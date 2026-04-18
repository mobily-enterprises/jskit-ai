import { HOME_TOOLS_OUTLET } from "./src/shared/toolsOutletContracts.js";

export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/users-web",
  version: "0.1.56",
  kind: "runtime",
  description: "Users web module: account/profile UI plus shared users web widgets.",
  dependsOn: [
    "@jskit-ai/auth-web",
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
          summary: "Exports surface route path resolver composable."
        },
        {
          subpath: "./client/composables/useAccountSettingsRuntime",
          summary: "Exports account settings runtime composable for app-owned settings UI."
        },
        {
          subpath: "./client/account-settings/sections",
          summary: "Exports account settings section extension seam helpers."
        }
      ],
      containerTokens: {
        server: [],
        client: [
          "users.web.home.tools.widget",
          "users.web.profile.element"
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
          }
        ],
        contributions: [
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
        "@jskit-ai/http-runtime": "0.1.40",
        "@jskit-ai/realtime": "0.1.40",
        "@jskit-ai/kernel": "0.1.41",
        "@jskit-ai/shell-web": "0.1.40",
        "@jskit-ai/uploads-image-web": "0.1.19",
        "@jskit-ai/users-core": "0.1.51",
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
        skipIfContains: "id: \"users.home.tools.widget\"",
        value:
          "\naddPlacement({\n  id: \"users.home.tools.widget\",\n  target: \"shell-layout:top-right\",\n  surfaces: [\"home\"],\n  order: 900,\n  componentToken: \"users.web.home.tools.widget\",\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n\naddPlacement({\n  id: \"users.home.menu.settings\",\n  target: \"home-tools:primary-menu\",\n  surfaces: [\"home\"],\n  order: 100,\n  componentToken: \"local.main.ui.surface-aware-menu-link-item\",\n  props: {\n    label: \"Settings\",\n    surface: \"home\",\n    scopedSuffix: \"/settings\",\n    unscopedSuffix: \"/settings\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append users-web home tools widget and settings menu placements into app-owned placement registry.",
        category: "users-web",
        id: "users-web-home-tools-placement"
      }
    ]
  }
});
