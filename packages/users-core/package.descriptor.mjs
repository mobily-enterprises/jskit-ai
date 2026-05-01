export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/users-core",
  version: "0.1.65",
  kind: "runtime",
  description: "Users/account runtime plus HTTP routes for account features.",
  dependsOn: [
    "@jskit-ai/auth-core",
    "@jskit-ai/database-runtime",
    "@jskit-ai/http-runtime",
    "@jskit-ai/json-rest-api-core",
    "@jskit-ai/resource-core",
    "@jskit-ai/resource-crud-core",
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
      "json-rest-api.core",
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
          summary: "Exports shared users settings resources and defaults."
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
        "@jskit-ai/auth-core": "0.1.54",
        "@jskit-ai/crud-core": "0.1.63",
        "@jskit-ai/database-runtime": "0.1.55",
        "@jskit-ai/http-runtime": "0.1.54",
        "@jskit-ai/json-rest-api-core": "0.1.0",
        "@jskit-ai/kernel": "0.1.55",
        "@jskit-ai/resource-core": "0.1.0",
        "@jskit-ai/resource-crud-core": "0.1.0",
        "@local/users": "file:packages/users",
        "@jskit-ai/uploads-runtime": "0.1.33"
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
        from: "templates/packages/users/package.json",
        to: "packages/users/package.json",
        ownership: "app",
        preserveOnRemove: true,
        reason: "Install app-owned users package manifest.",
        category: "users-core",
        id: "users-core-users-package-json"
      },
      {
        from: "templates/packages/users/package.descriptor.mjs",
        to: "packages/users/package.descriptor.mjs",
        ownership: "app",
        preserveOnRemove: true,
        reason: "Install app-owned users package descriptor for non-workspace tenancy.",
        category: "users-core",
        id: "users-core-users-package-descriptor-base",
        when: {
          config: "tenancyMode",
          notIn: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/packages/users-workspace/package.descriptor.mjs",
        to: "packages/users/package.descriptor.mjs",
        ownership: "app",
        preserveOnRemove: true,
        reason: "Install app-owned users package descriptor for workspace tenancy.",
        category: "users-core",
        id: "users-core-users-package-descriptor-workspace",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/packages/users/src/server/UsersProvider.js",
        to: "packages/users/src/server/UsersProvider.js",
        ownership: "app",
        preserveOnRemove: true,
        reason: "Install app-owned users CRUD provider for non-workspace tenancy.",
        category: "users-core",
        id: "users-core-users-provider-base",
        when: {
          config: "tenancyMode",
          notIn: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/packages/users-workspace/src/server/UsersProvider.js",
        to: "packages/users/src/server/UsersProvider.js",
        ownership: "app",
        preserveOnRemove: true,
        reason: "Install app-owned users CRUD provider for workspace tenancy.",
        category: "users-core",
        id: "users-core-users-provider-workspace",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/packages/users/src/server/actions.js",
        to: "packages/users/src/server/actions.js",
        ownership: "app",
        preserveOnRemove: true,
        reason: "Install app-owned users CRUD actions for non-workspace tenancy.",
        category: "users-core",
        id: "users-core-users-actions-base",
        when: {
          config: "tenancyMode",
          notIn: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/packages/users-workspace/src/server/actions.js",
        to: "packages/users/src/server/actions.js",
        ownership: "app",
        preserveOnRemove: true,
        reason: "Install app-owned users CRUD actions for workspace tenancy.",
        category: "users-core",
        id: "users-core-users-actions-workspace",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/packages/users/src/server/registerRoutes.js",
        to: "packages/users/src/server/registerRoutes.js",
        ownership: "app",
        preserveOnRemove: true,
        reason: "Install app-owned users CRUD routes for non-workspace tenancy.",
        category: "users-core",
        id: "users-core-users-routes-base",
        when: {
          config: "tenancyMode",
          notIn: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/packages/users-workspace/src/server/registerRoutes.js",
        to: "packages/users/src/server/registerRoutes.js",
        ownership: "app",
        preserveOnRemove: true,
        reason: "Install app-owned users CRUD routes for workspace tenancy.",
        category: "users-core",
        id: "users-core-users-routes-workspace",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        from: "templates/packages/users/src/server/repository.js",
        to: "packages/users/src/server/repository.js",
        ownership: "app",
        preserveOnRemove: true,
        reason: "Install app-owned users CRUD repository.",
        category: "users-core",
        id: "users-core-users-repository"
      },
      {
        from: "templates/packages/users/src/server/service.js",
        to: "packages/users/src/server/service.js",
        ownership: "app",
        preserveOnRemove: true,
        reason: "Install app-owned users CRUD service.",
        category: "users-core",
        id: "users-core-users-service"
      },
      {
        from: "templates/packages/users/src/shared/index.js",
        to: "packages/users/src/shared/index.js",
        ownership: "app",
        preserveOnRemove: true,
        reason: "Install app-owned users shared entrypoint.",
        category: "users-core",
        id: "users-core-users-shared-index"
      },
      {
        from: "templates/packages/users/src/shared/userResource.js",
        to: "packages/users/src/shared/userResource.js",
        ownership: "app",
        preserveOnRemove: true,
        reason: "Install app-owned users shared resource.",
        category: "users-core",
        id: "users-core-users-resource"
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
    ]
  }
});
