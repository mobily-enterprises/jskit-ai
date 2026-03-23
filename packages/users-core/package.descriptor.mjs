export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/users-core",
  version: "0.1.19",
  description: "Users/workspace domain runtime plus HTTP routes for workspace, account, and console features.",
  dependsOn: [
    "@jskit-ai/auth-core",
    "@jskit-ai/database-runtime",
    "@jskit-ai/http-runtime",
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
            "Exports UsersCoreServiceProvider, users/workspace/console repositories/services, feature route registration modules, and action definitions."
        },
        {
          subpath: "./shared",
          summary: "Exports shared users/workspace role and settings utilities."
        },
        {
          subpath: "./client",
          summary: "Exports no runtime API today (reserved client entrypoint)."
        }
      ],
      containerTokens: {
        server: [
          "users.core",
          "users.profile.sync.service",
          "users.workspace.service",
          "users.workspace.members.service",
          "users.workspace.settings.service",
          "users.settings.service",
          "users.console.settings.service"
        ],
        client: []
      }
    },
    server: {
      routes: [
        {
          method: "POST",
          path: "/api/workspaces",
          summary: "Create a workspace for the authenticated user."
        },
        {
          method: "GET",
          path: "/api/workspaces",
          summary: "List workspaces visible to authenticated user."
        },
        {
          method: "GET",
          path: "/api/workspace/invitations/pending",
          summary: "List pending workspace invitations for authenticated user."
        },
        {
          method: "POST",
          path: "/api/workspace/invitations/redeem",
          summary: "Accept or refuse a workspace invitation using an invite token."
        },
        {
          method: "GET",
          path: "/api/w/:workspaceSlug/workspace/settings",
          summary: "Get workspace settings and role catalog by workspace slug."
        },
        {
          method: "PATCH",
          path: "/api/w/:workspaceSlug/workspace/settings",
          summary: "Update workspace settings by workspace slug."
        },
        {
          method: "GET",
          path: "/api/w/:workspaceSlug/workspace/roles",
          summary: "Get workspace role catalog by workspace slug."
        },
        {
          method: "GET",
          path: "/api/w/:workspaceSlug/workspace/members",
          summary: "List members by workspace slug."
        },
        {
          method: "PATCH",
          path: "/api/w/:workspaceSlug/workspace/members/:memberUserId/role",
          summary: "Update workspace member role by workspace slug."
        },
        {
          method: "GET",
          path: "/api/w/:workspaceSlug/workspace/invites",
          summary: "List workspace invites by workspace slug."
        },
        {
          method: "POST",
          path: "/api/w/:workspaceSlug/workspace/invites",
          summary: "Create workspace invite by workspace slug."
        },
        {
          method: "DELETE",
          path: "/api/w/:workspaceSlug/workspace/invites/:inviteId",
          summary: "Revoke workspace invite by workspace slug."
        },
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
        },
        {
          method: "GET",
          path: "/api/console/settings",
          summary: "Get console settings."
        },
        {
          method: "PATCH",
          path: "/api/console/settings",
          summary: "Update console settings."
        }
      ]
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/auth-core": "0.1.14",
        "@jskit-ai/database-runtime": "0.1.15",
        "@jskit-ai/http-runtime": "0.1.14",
        "@jskit-ai/kernel": "0.1.14",
        "@fastify/multipart": "^9.4.0",
        "@fastify/type-provider-typebox": "^6.1.0",
        "typebox": "^1.0.81"
      },
      dev: {}
    },
    packageJson: {
      scripts: {
        "server:app": "SERVER_SURFACE=app node ./bin/server.js",
        "server:admin": "SERVER_SURFACE=admin node ./bin/server.js",
        "dev:app": "VITE_SURFACE=app vite",
        "dev:admin": "VITE_SURFACE=admin vite",
        "build:app": "VITE_SURFACE=app vite build",
        "build:admin": "VITE_SURFACE=admin vite build"
      }
    },
    procfile: {},
    files: [
      {
        op: "install-migration",
        from: "templates/migrations/users_core_initial.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install users/workspace core schema migration.",
        category: "migration",
        id: "users-core-initial-schema"
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
        op: "install-migration",
        from: "templates/migrations/users_core_console_owner.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install users/workspace console owner migration.",
        category: "migration",
        id: "users-core-console-owner-schema"
      },
      {
        from: "templates/packages/main/src/shared/resources/workspaceSettingsFields.js",
        to: "packages/main/src/shared/resources/workspaceSettingsFields.js",
        preserveOnRemove: true,
        reason: "Install app-owned workspace settings field definitions.",
        category: "users-core",
        id: "users-core-app-owned-workspace-settings-fields"
      },
      {
        from: "templates/packages/main/src/shared/resources/consoleSettingsFields.js",
        to: "packages/main/src/shared/resources/consoleSettingsFields.js",
        preserveOnRemove: true,
        reason: "Install app-owned console settings field definitions.",
        category: "users-core",
        id: "users-core-app-owned-console-settings-fields"
      },
      {
        from: "templates/packages/main/src/shared/resources/userSettingsFields.js",
        to: "packages/main/src/shared/resources/userSettingsFields.js",
        preserveOnRemove: true,
        reason: "Install app-owned user settings field definitions.",
        category: "users-core",
        id: "users-core-app-owned-user-settings-fields"
      },
      {
        from: "templates/config/workspaceRoles.js",
        to: "config/workspaceRoles.js",
        preserveOnRemove: true,
        reason: "Install app-owned workspace role catalog in a dedicated config file.",
        category: "users-core",
        id: "users-core-app-owned-workspace-roles-config"
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
        skipIfContains: "import \"./resources/workspaceSettingsFields.js\";",
        value: "import \"./resources/workspaceSettingsFields.js\";\n",
        reason: "Load app-owned workspace settings field definitions inside the main shared module.",
        category: "users-core",
        id: "users-core-main-shared-workspace-settings-field-import"
      },
      {
        op: "append-text",
        file: "packages/main/src/shared/index.js",
        position: "top",
        skipIfContains: "import \"./resources/consoleSettingsFields.js\";",
        value: "import \"./resources/consoleSettingsFields.js\";\n",
        reason: "Load app-owned console settings field definitions inside the main shared module.",
        category: "users-core",
        id: "users-core-main-shared-console-settings-field-import"
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
      },
      {
        op: "append-text",
        file: "config/public.js",
        position: "top",
        skipIfContains: "import { workspaceRoles } from \"./workspaceRoles.js\";",
        value: "import { workspaceRoles } from \"./workspaceRoles.js\";\n",
        reason: "Load app-owned workspace role catalog from dedicated config file.",
        category: "users-core",
        id: "users-core-workspace-roles-public-import"
      },
      {
        op: "append-text",
        file: "config/public.js",
        position: "top",
        skipIfContains: "import { surfaceAccessPolicies } from \"./surfaceAccessPolicies.js\";",
        value: "import { surfaceAccessPolicies } from \"./surfaceAccessPolicies.js\";\n",
        reason: "Load app-owned surface access policy catalog from dedicated config file.",
        category: "users-core",
        id: "users-core-surface-access-policies-public-import"
      },
      {
        op: "append-text",
        file: "config/surfaceAccessPolicies.js",
        position: "top",
        skipIfContains: "export const surfaceAccessPolicies = {};",
        value: "export const surfaceAccessPolicies = {};\n\n",
        reason: "Initialize app-owned surface access policy config if missing.",
        category: "users-core",
        id: "users-core-surface-access-policies-config-init"
      },
      {
        op: "append-text",
        file: "config/surfaceAccessPolicies.js",
        position: "bottom",
        skipIfContains: "surfaceAccessPolicies.workspace_member = {",
        value: "\nsurfaceAccessPolicies.workspace_member = {\n  requireAuth: true,\n  requireWorkspaceMembership: true\n};\n",
        reason: "Register workspace-member surface access policy for workspace surfaces.",
        category: "users-core",
        id: "users-core-surface-access-policies-workspace-member"
      },
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.surfaceDefinitions.app = {",
        value:
          "\nconfig.surfaceDefinitions.app = {\n  id: \"app\",\n  label: \"App\",\n  pagesRoot: \"w/[workspaceSlug]\",\n  enabled: true,\n  requiresAuth: true,\n  requiresWorkspace: true,\n  accessPolicyId: \"workspace_member\",\n  origin: \"\"\n};\n\nconfig.surfaceDefinitions.admin = {\n  id: \"admin\",\n  label: \"Admin\",\n  pagesRoot: \"w/[workspaceSlug]/admin\",\n  enabled: true,\n  requiresAuth: true,\n  requiresWorkspace: true,\n  accessPolicyId: \"workspace_member\",\n  origin: \"\"\n};\n",
        reason: "Append workspace surface topology when tenancy enables workspace routing.",
        category: "users-core",
        id: "users-core-surface-config-workspace",
        when: {
          config: "tenancyMode",
          in: ["personal", "workspaces"]
        }
      },
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.workspaceSwitching =",
        value:
          "\nconfig.workspaceSwitching = true;\nconfig.workspaceInvitations = {\n  enabled: true,\n  allowInPersonalMode: true\n};\nconfig.assistantEnabled = false;\nconfig.assistantRequiredPermission = \"\";\nconfig.socialEnabled = false;\nconfig.socialFederationEnabled = false;\n",
        reason: "Append default public users/workspace feature toggles into app-owned config.",
        category: "users-core",
        id: "users-core-public-config"
      },
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.workspaceRoles = workspaceRoles;",
        value: "\nconfig.workspaceRoles = workspaceRoles;\n",
        reason: "Bind app-owned workspace role catalog onto public config.",
        category: "users-core",
        id: "users-core-workspace-roles-public-config"
      },
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.surfaceAccessPolicies = surfaceAccessPolicies;",
        value: "\nconfig.surfaceAccessPolicies = surfaceAccessPolicies;\n",
        reason: "Bind app-owned surface access policies onto public config.",
        category: "users-core",
        id: "users-core-surface-access-policies-public-config"
      },
      {
        op: "append-text",
        file: "config/server.js",
        position: "bottom",
        skipIfContains: "config.workspaceColor =",
        value: "\nconfig.workspaceColor = \"#1867C0\";\n",
        reason: "Append default server-only users/workspace settings into app-owned config.",
        category: "users-core",
        id: "users-core-server-config"
      },
      {
        op: "append-text",
        file: "config/server.js",
        position: "bottom",
        skipIfContains: "config.workspaceSettings =",
        value:
          "\nconfig.workspaceSettings = {\n  defaults: {\n    invitesEnabled: true\n  }\n};\n",
        reason: "Append app-owned workspace settings defaults into the server config.",
        category: "users-core",
        id: "users-core-workspace-settings-server-config"
      },
      {
        op: "append-text",
        file: "config/server.js",
        position: "bottom",
        skipIfContains: "config.workspaceMembers =",
        value:
          "\nconfig.workspaceMembers = {\n  defaults: {\n    inviteExpiresInMs: 604800000\n  }\n};\n",
        reason: "Append app-owned workspace member invite policy defaults into the server config.",
        category: "users-core",
        id: "users-core-workspace-members-server-config"
      },
    ]
  }
});
