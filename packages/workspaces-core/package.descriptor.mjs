export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/workspaces-core",
  version: "0.1.22",
  kind: "runtime",
  description: "Workspace tenancy runtime plus HTTP routes, role catalog, and workspace config scaffolding.",
  dependsOn: [
    "@jskit-ai/users-core"
  ],
  capabilities: {
    provides: [
      "workspaces.core",
      "workspaces.server-routes"
    ],
    requires: [
      "users.core"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/WorkspacesCoreServiceProvider.js",
          export: "WorkspacesCoreServiceProvider"
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
          summary: "Exports the workspace runtime provider and workspace route registration surface."
        }
      ],
      containerTokens: {
        server: [
          "workspaces.server.scope-support"
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
          path: "/api/w/:workspaceSlug/settings",
          summary: "Get workspace settings and role catalog by workspace slug."
        },
        {
          method: "PATCH",
          path: "/api/w/:workspaceSlug/settings",
          summary: "Update workspace settings by workspace slug."
        },
        {
          method: "GET",
          path: "/api/w/:workspaceSlug/roles",
          summary: "Get role catalog by workspace slug."
        },
        {
          method: "GET",
          path: "/api/w/:workspaceSlug/members",
          summary: "List members by workspace slug."
        },
        {
          method: "PATCH",
          path: "/api/w/:workspaceSlug/members/:memberUserId/role",
          summary: "Update workspace member role by workspace slug."
        },
        {
          method: "GET",
          path: "/api/w/:workspaceSlug/invites",
          summary: "List workspace invites by workspace slug."
        },
        {
          method: "POST",
          path: "/api/w/:workspaceSlug/invites",
          summary: "Create workspace invite by workspace slug."
        },
        {
          method: "DELETE",
          path: "/api/w/:workspaceSlug/invites/:inviteId",
          summary: "Revoke workspace invite by workspace slug."
        }
      ]
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/users-core": "0.1.56"
      },
      dev: {}
    },
    packageJson: {
      scripts: {
        "server:app": "SERVER_SURFACE=app node ./bin/server.js",
        "server:admin": "SERVER_SURFACE=admin node ./bin/server.js"
      }
    },
    procfile: {},
    files: [
      {
        op: "install-migration",
        from: "templates/migrations/workspaces_core_initial.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install workspace tenancy schema migration.",
        category: "migration",
        id: "workspaces-core-initial-schema"
      },
      {
        op: "install-migration",
        from: "templates/migrations/workspaces_core_workspace_settings_single_name_source.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Remove workspace_settings name/avatar fields so workspace identity data comes from workspaces only.",
        category: "migration",
        id: "users-core-workspace-settings-single-name-source"
      },
      {
        op: "install-migration",
        from: "templates/migrations/workspaces_core_workspaces_drop_color.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Drop legacy workspaces.color now that workspace theme colors live in workspace_settings.",
        category: "migration",
        id: "users-core-workspaces-drop-color"
      },
      {
        from: "templates/packages/main/src/shared/resources/workspaceSettingsFields.js",
        to: "packages/main/src/shared/resources/workspaceSettingsFields.js",
        preserveOnRemove: true,
        reason: "Install app-owned workspace settings field definitions.",
        category: "workspaces-core",
        id: "users-core-app-owned-workspace-settings-fields"
      },
      {
        from: "templates/config/roles.js",
        to: "config/roles.js",
        preserveOnRemove: true,
        reason: "Install app-owned role catalog in a dedicated config file.",
        category: "workspaces-core",
        id: "users-core-app-owned-role-catalog-config"
      }
    ],
    text: [
      {
        op: "append-text",
        file: "packages/main/src/shared/index.js",
        position: "top",
        skipIfContains: "import \"./resources/workspaceSettingsFields.js\";",
        value: "import \"./resources/workspaceSettingsFields.js\";\n",
        reason: "Load app-owned workspace settings field definitions inside the main shared module.",
        category: "workspaces-core",
        id: "users-core-main-shared-workspace-settings-field-import"
      },
      {
        op: "append-text",
        file: "config/public.js",
        position: "top",
        skipIfContains: "import { roleCatalog } from \"./roles.js\";",
        value: "import { roleCatalog } from \"./roles.js\";\n",
        reason: "Load app-owned role catalog from dedicated config file.",
        category: "workspaces-core",
        id: "users-core-role-catalog-public-import"
      },
      {
        op: "append-text",
        file: "config/public.js",
        position: "top",
        skipIfContains: "import { surfaceAccessPolicies } from \"./surfaceAccessPolicies.js\";",
        value: "import { surfaceAccessPolicies } from \"./surfaceAccessPolicies.js\";\n",
        reason: "Load app-owned surface access policy catalog from dedicated config file.",
        category: "workspaces-core",
        id: "users-core-surface-access-policies-public-import"
      },
      {
        op: "append-text",
        file: "config/surfaceAccessPolicies.js",
        position: "top",
        skipIfContains: "export const surfaceAccessPolicies = {};",
        value: "export const surfaceAccessPolicies = {};\n\n",
        reason: "Initialize app-owned surface access policy config if missing.",
        category: "workspaces-core",
        id: "users-core-surface-access-policies-config-init"
      },
      {
        op: "append-text",
        file: "config/surfaceAccessPolicies.js",
        position: "bottom",
        skipIfContains: "surfaceAccessPolicies.workspace_member = {",
        value: "\nsurfaceAccessPolicies.workspace_member = {\n  requireAuth: true,\n  requireWorkspaceMembership: true\n};\n",
        reason: "Register workspace-member surface access policy for workspace surfaces.",
        category: "workspaces-core",
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
        category: "workspaces-core",
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
          "\nconfig.workspaceSwitching = true;\nconfig.workspaceInvitations = {\n  enabled: true,\n  allowInPersonalMode: true\n};\n",
        reason: "Append default workspace feature toggles into app-owned config.",
        category: "workspaces-core",
        id: "users-core-public-config"
      },
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.roleCatalog = roleCatalog;",
        value: "\nconfig.roleCatalog = roleCatalog;\n",
        reason: "Bind app-owned role catalog onto public config.",
        category: "workspaces-core",
        id: "users-core-role-catalog-public-config"
      },
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.surfaceAccessPolicies = surfaceAccessPolicies;",
        value: "\nconfig.surfaceAccessPolicies = surfaceAccessPolicies;\n",
        reason: "Bind app-owned surface access policies onto public config.",
        category: "workspaces-core",
        id: "users-core-surface-access-policies-public-config"
      },
      {
        op: "append-text",
        file: "config/server.js",
        position: "bottom",
        skipIfContains: "config.workspaceColor =",
        value: "\nconfig.workspaceColor = \"#1867C0\";\n",
        reason: "Append default workspace server settings into app-owned config.",
        category: "workspaces-core",
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
        category: "workspaces-core",
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
        category: "workspaces-core",
        id: "users-core-workspace-members-server-config"
      }
    ]
  }
});
