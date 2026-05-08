import { HOME_COG_OUTLET } from "./src/shared/toolsOutletContracts.js";

export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/users-web",
  version: "0.1.81",
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
          subpath: "./client/components/AccountSettingsClientElement",
          summary: "Exports the package-owned account settings host that renders placement-backed account sections."
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
          subpath: "./client/composables/useEndpointResource",
          summary: "Exports low-level endpoint resource composable for custom client requests."
        },
        {
          subpath: "./client/composables/useCrudListFilterLookups",
          summary: "Exports lookup-backed CRUD list filter helper for remote autocomplete filters."
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
          subpath: "./client/lib/httpClient",
          summary: "Exports the shared users-web HTTP client with credentials and CSRF behavior."
        },
        {
          subpath: "./client/account-settings/sections",
          summary: "Exports placement-backed account settings section helpers."
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
            target: HOME_COG_OUTLET.target,
            surfaces: ["home"],
            source: "src/client/components/UsersHomeToolsWidget.vue"
          },
          {
            target: "account-settings:sections",
            surfaces: ["account"],
            source: "src/client/components/AccountSettingsClientElement.vue"
          }
        ],
        topology: {
          placements: [
            {
              id: "home.tools-menu",
              description: "Home surface tools menu actions.",
              surfaces: ["home"],
              variants: {
                compact: {
                  outlet: HOME_COG_OUTLET.target,
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                },
                medium: {
                  outlet: HOME_COG_OUTLET.target,
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                },
                expanded: {
                  outlet: HOME_COG_OUTLET.target,
                  renderers: {
                    link: "local.main.ui.surface-aware-menu-link-item"
                  }
                }
              }
            },
            {
              id: "settings.sections",
              owner: "account-settings",
              description: "Account settings content sections.",
              surfaces: ["account"],
              variants: {
                compact: {
                  outlet: "account-settings:sections"
                },
                medium: {
                  outlet: "account-settings:sections"
                },
                expanded: {
                  outlet: "account-settings:sections"
                }
              }
            }
          ]
        },
        contributions: [
          {
            id: "users.profile.menu.settings",
            target: "auth.profile-menu",
            kind: "link",
            surfaces: ["*"],
            order: 500,
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-profile-settings-placement"
          },
          {
            id: "users.home.tools.widget",
            target: "shell.status",
            kind: "component",
            surfaces: ["home"],
            order: 900,
            componentToken: "users.web.home.tools.widget",
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-home-tools-placement"
          },
          {
            id: "users.home.menu.settings",
            target: "home.tools-menu",
            kind: "link",
            surfaces: ["home"],
            order: 100,
            when: "auth.authenticated === true",
            source: "mutations.text#users-web-home-tools-placement"
          },
          {
            id: "users.account.settings.profile",
            target: "settings.sections",
            owner: "account-settings",
            kind: "component",
            surfaces: ["account"],
            order: 100,
            componentToken: "local.main.account-settings.section.profile",
            source: "mutations.text#users-web-account-settings-sections-placement"
          },
          {
            id: "users.account.settings.preferences",
            target: "settings.sections",
            owner: "account-settings",
            kind: "component",
            surfaces: ["account"],
            order: 200,
            componentToken: "local.main.account-settings.section.preferences",
            source: "mutations.text#users-web-account-settings-sections-placement"
          },
          {
            id: "users.account.settings.notifications",
            target: "settings.sections",
            owner: "account-settings",
            kind: "component",
            surfaces: ["account"],
            order: 300,
            componentToken: "local.main.account-settings.section.notifications",
            source: "mutations.text#users-web-account-settings-sections-placement"
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
        "@jskit-ai/http-runtime": "0.1.65",
        "@jskit-ai/realtime": "0.1.65",
        "@jskit-ai/kernel": "0.1.66",
        "@jskit-ai/shell-web": "0.1.65",
        "@jskit-ai/uploads-image-web": "0.1.44",
        "@jskit-ai/users-core": "0.1.76",
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
          "\naddPlacement({\n  id: \"users.profile.menu.settings\",\n  target: \"auth.profile-menu\",\n  kind: \"link\",\n  surfaces: [\"*\"],\n  order: 500,\n  props: {\n    label: \"Settings\",\n    to: \"/account\"\n  },\n  when: ({ auth }) => auth?.authenticated === true\n});\n",
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
          "\naddPlacement({\n  id: \"users.home.tools.widget\",\n  target: \"shell.status\",\n  kind: \"component\",\n  surfaces: [\"home\"],\n  order: 900,\n  componentToken: \"users.web.home.tools.widget\",\n  when: ({ auth }) => auth?.authenticated === true\n});\n\naddPlacement({\n  id: \"users.home.menu.settings\",\n  target: \"home.tools-menu\",\n  kind: \"link\",\n  surfaces: [\"home\"],\n  order: 100,\n  props: {\n    label: \"Settings\",\n    surface: \"home\",\n    scopedSuffix: \"/settings\",\n    unscopedSuffix: \"/settings\"\n  },\n  when: ({ auth }) => auth?.authenticated === true\n});\n",
        reason: "Append users-web home tools widget and settings menu placements into app-owned placement registry.",
        category: "users-web",
        id: "users-web-home-tools-placement"
      },
      {
        op: "append-text",
        file: "src/placementTopology.js",
        position: "bottom",
        skipIfContains: "id: \"home.tools-menu\"",
        value:
          "\naddPlacementTopology({\n  id: \"home.tools-menu\",\n  description: \"Home surface tools menu actions.\",\n  surfaces: [\"home\"],\n  variants: {\n    compact: {\n      outlet: \"home-cog:primary-menu\",\n      renderers: {\n        link: \"local.main.ui.surface-aware-menu-link-item\"\n      }\n    },\n    medium: {\n      outlet: \"home-cog:primary-menu\",\n      renderers: {\n        link: \"local.main.ui.surface-aware-menu-link-item\"\n      }\n    },\n    expanded: {\n      outlet: \"home-cog:primary-menu\",\n      renderers: {\n        link: \"local.main.ui.surface-aware-menu-link-item\"\n      }\n    }\n  }\n});\n",
        reason: "Append users-web home tools semantic topology into app-owned placement topology.",
        category: "users-web",
        id: "users-web-home-tools-topology"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"users.account.settings.profile\"",
        value:
          "\naddPlacement({\n  id: \"users.account.settings.profile\",\n  target: \"settings.sections\",\n  owner: \"account-settings\",\n  kind: \"component\",\n  surfaces: [\"account\"],\n  order: 100,\n  componentToken: \"local.main.account-settings.section.profile\",\n  props: {\n    title: \"Profile\",\n    value: \"profile\",\n    usesSharedRuntime: true\n  }\n});\n\naddPlacement({\n  id: \"users.account.settings.preferences\",\n  target: \"settings.sections\",\n  owner: \"account-settings\",\n  kind: \"component\",\n  surfaces: [\"account\"],\n  order: 200,\n  componentToken: \"local.main.account-settings.section.preferences\",\n  props: {\n    title: \"Preferences\",\n    value: \"preferences\",\n    usesSharedRuntime: true\n  }\n});\n\naddPlacement({\n  id: \"users.account.settings.notifications\",\n  target: \"settings.sections\",\n  owner: \"account-settings\",\n  kind: \"component\",\n  surfaces: [\"account\"],\n  order: 300,\n  componentToken: \"local.main.account-settings.section.notifications\",\n  props: {\n    title: \"Notifications\",\n    value: \"notifications\",\n    usesSharedRuntime: true\n  }\n});\n",
        reason: "Append users-web account settings section placements into the app-owned placement registry.",
        category: "users-web",
        id: "users-web-account-settings-sections-placement"
      },
      {
        op: "append-text",
        file: "src/placementTopology.js",
        position: "bottom",
        skipIfContains: "id: \"settings.sections\"",
        value:
          "\naddPlacementTopology({\n  id: \"settings.sections\",\n  owner: \"account-settings\",\n  description: \"Account settings content sections.\",\n  surfaces: [\"account\"],\n  variants: {\n    compact: {\n      outlet: \"account-settings:sections\"\n    },\n    medium: {\n      outlet: \"account-settings:sections\"\n    },\n    expanded: {\n      outlet: \"account-settings:sections\"\n    }\n  }\n});\n",
        reason: "Append users-web account settings semantic topology into app-owned placement topology.",
        category: "users-web",
        id: "users-web-account-settings-topology"
      },
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "top",
        skipIfContains: "import AccountSettingsProfileSection from \"/src/components/account/settings/AccountSettingsProfileSection.vue\";",
        value: "import AccountSettingsProfileSection from \"/src/components/account/settings/AccountSettingsProfileSection.vue\";\n",
        reason: "Bind the app-owned account profile settings section into local main client provider imports.",
        category: "users-web",
        id: "users-web-main-client-provider-account-settings-profile-import"
      },
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "top",
        skipIfContains: "import AccountSettingsPreferencesSection from \"/src/components/account/settings/AccountSettingsPreferencesSection.vue\";",
        value: "import AccountSettingsPreferencesSection from \"/src/components/account/settings/AccountSettingsPreferencesSection.vue\";\n",
        reason: "Bind the app-owned account preferences settings section into local main client provider imports.",
        category: "users-web",
        id: "users-web-main-client-provider-account-settings-preferences-import"
      },
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "top",
        skipIfContains: "import AccountSettingsNotificationsSection from \"/src/components/account/settings/AccountSettingsNotificationsSection.vue\";",
        value: "import AccountSettingsNotificationsSection from \"/src/components/account/settings/AccountSettingsNotificationsSection.vue\";\n",
        reason: "Bind the app-owned account notifications settings section into local main client provider imports.",
        category: "users-web",
        id: "users-web-main-client-provider-account-settings-notifications-import"
      },
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "bottom",
        skipIfContains: "registerMainClientComponent(\"local.main.account-settings.section.profile\", () => AccountSettingsProfileSection);",
        value: "\nregisterMainClientComponent(\"local.main.account-settings.section.profile\", () => AccountSettingsProfileSection);\n",
        reason: "Bind the app-owned account profile settings section token into local main client provider registry.",
        category: "users-web",
        id: "users-web-main-client-provider-account-settings-profile-register"
      },
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "bottom",
        skipIfContains: "registerMainClientComponent(\"local.main.account-settings.section.preferences\", () => AccountSettingsPreferencesSection);",
        value: "\nregisterMainClientComponent(\"local.main.account-settings.section.preferences\", () => AccountSettingsPreferencesSection);\n",
        reason: "Bind the app-owned account preferences settings section token into local main client provider registry.",
        category: "users-web",
        id: "users-web-main-client-provider-account-settings-preferences-register"
      },
      {
        op: "append-text",
        file: "packages/main/src/client/providers/MainClientProvider.js",
        position: "bottom",
        skipIfContains: "registerMainClientComponent(\"local.main.account-settings.section.notifications\", () => AccountSettingsNotificationsSection);",
        value: "\nregisterMainClientComponent(\"local.main.account-settings.section.notifications\", () => AccountSettingsNotificationsSection);\n",
        reason: "Bind the app-owned account notifications settings section token into local main client provider registry.",
        category: "users-web",
        id: "users-web-main-client-provider-account-settings-notifications-register"
      }
    ]
  }
});
