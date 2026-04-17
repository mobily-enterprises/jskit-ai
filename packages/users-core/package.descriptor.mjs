export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/users-core",
  version: "0.1.47",
  kind: "runtime",
  description: "Users/account runtime plus HTTP routes for account features.",
  dependsOn: [
    "@jskit-ai/auth-core",
    "@jskit-ai/database-runtime",
    "@jskit-ai/http-runtime",
    "@jskit-ai/uploads-runtime",
    "@jskit-ai/storage-runtime"
  ],
  capabilities: {
    provides: [
      "users.core",
      "users.server-routes"
    ],
    requires: [
      "runtime.actions",
      "runtime.database",
      "runtime.storage",
      "runtime.uploads",
      "auth.provider",
      "auth.policy"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/UsersCoreServiceProvider.js",
          export: "UsersCoreServiceProvider"
        }
      ]
    },
    client: {
      providers: []
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./server",
          summary:
            "Exports UsersCoreServiceProvider plus account feature route registration modules and action definitions."
        },
        {
          subpath: "./shared",
          summary: "Exports shared users settings and tenancy utilities."
        },
        {
          subpath: "./client",
          summary: "Exports no runtime API today (reserved client entrypoint)."
        }
      ],
      containerTokens: {
        server: [],
        client: []
      }
    },
    server: {
      routes: [
        {
          method: "GET",
          path: "/api/settings",
          summary: "Get authenticated user settings."
        },
        {
          method: "PATCH",
          path: "/api/settings/profile",
          summary: "Update profile settings."
        },
        {
          method: "GET",
          path: "/api/settings/profile/avatar",
          summary: "Read authenticated user's uploaded avatar."
        },
        {
          method: "POST",
          path: "/api/settings/profile/avatar",
          summary: "Upload profile avatar."
        },
        {
          method: "DELETE",
          path: "/api/settings/profile/avatar",
          summary: "Delete profile avatar."
        },
        {
          method: "PATCH",
          path: "/api/settings/preferences",
          summary: "Update user preferences."
        },
        {
          method: "PATCH",
          path: "/api/settings/notifications",
          summary: "Update notification settings."
        },
        {
          method: "POST",
          path: "/api/settings/security/change-password",
          summary: "Set or change password for authenticated user."
        },
        {
          method: "PATCH",
          path: "/api/settings/security/methods/password",
          summary: "Enable or disable password sign-in method."
        },
        {
          method: "GET",
          path: "/api/settings/security/oauth/:provider/start",
          summary: "Start linking an OAuth provider for authenticated user."
        },
        {
          method: "DELETE",
          path: "/api/settings/security/oauth/:provider",
          summary: "Unlink an OAuth provider from authenticated account."
        },
        {
          method: "POST",
          path: "/api/settings/security/logout-others",
          summary: "Sign out from other active sessions."
        }
      ]
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/auth-core": "0.1.36",
        "@jskit-ai/database-runtime": "0.1.37",
        "@jskit-ai/http-runtime": "0.1.36",
        "@jskit-ai/kernel": "0.1.37",
        "@jskit-ai/uploads-runtime": "0.1.15",
        "@fastify/type-provider-typebox": "^6.1.0",
        typebox: "^1.0.81"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [
      {
        op: "install-migration",
        from: "templates/migrations/users_core_generic_initial.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install users/account core schema migration.",
        category: "migration",
        id: "users-core-generic-initial-schema"
      },
      {
        op: "install-migration",
        from: "templates/migrations/users_core_profile_username.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install users profile username migration.",
        category: "migration",
        id: "users-core-profile-username-schema"
      },
      {
        from: "templates/packages/main/src/shared/resources/userSettingsFields.js",
        to: "packages/main/src/shared/resources/userSettingsFields.js",
        preserveOnRemove: true,
        reason: "Install app-owned user settings field definitions.",
        category: "users-core",
        id: "users-core-app-owned-user-settings-fields"
      }
    ],
    text: [
      {
        op: "upsert-env",
        file: ".env",
        key: "AUTH_PROFILE_MODE",
        value: "users",
        reason: "Enable users-backed auth profile sync when users-core is installed.",
        category: "runtime-config",
        id: "users-core-auth-profile-mode"
      },
      {
        op: "append-text",
        file: "packages/main/src/shared/index.js",
        position: "top",
        skipIfContains: "import \"./resources/userSettingsFields.js\";",
        value: "import \"./resources/userSettingsFields.js\";\n",
        reason: "Load app-owned user settings field definitions inside the main shared module.",
        category: "users-core",
        id: "users-core-main-shared-user-settings-field-import"
      },
      {
        op: "append-text",
        file: "src/main.js",
        position: "top",
        skipIfContains: "import \"@local/main/shared\";",
        value: "import \"@local/main/shared\";\n",
        reason: "Ensure client runtime loads app-owned shared settings field registration.",
        category: "users-core",
        id: "users-core-client-import-main-shared"
      },
      {
        op: "append-text",
        file: "server.js",
        position: "top",
        skipIfContains: "import \"@local/main/shared\";",
        value: "import \"@local/main/shared\";\n",
        reason: "Ensure server runtime loads app-owned shared settings field registration.",
        category: "users-core",
        id: "users-core-server-import-main-shared"
      }
    ]
  }
});
