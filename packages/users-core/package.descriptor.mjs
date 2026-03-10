export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/users-core",
  version: "0.1.0",
  description: "Users/workspace domain runtime: profiles, tenancy/workspace logic, and settings actions.",
  dependsOn: [
    "@jskit-ai/auth-core",
    "@jskit-ai/database-runtime"
  ],
  capabilities: {
    provides: [
      "users.core"
    ],
    requires: [
      "runtime.actions",
      "runtime.database"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/providers/UsersCoreServiceProvider.js",
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
            "Exports UsersCoreServiceProvider, users/workspace/console repositories/services, and workspace/settings/console action definitions."
        },
        {
          subpath: "./shared",
          summary: "Exports shared users/workspace role and settings defaults."
        },
        {
          subpath: "./client",
          summary: "Exports no runtime API today (reserved client entrypoint)."
        }
      ],
      containerTokens: {
        server: [
          "users.core",
          "users.workspace.service",
          "users.workspace.admin.service",
          "users.workspace.settings.service",
          "users.settings.service",
          "users.console.settings.service"
        ],
        client: []
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/auth-core": "0.1.0",
        "@jskit-ai/database-runtime": "0.1.0",
        "@jskit-ai/kernel": "0.1.0",
        "typebox": "^1.0.81"
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
        from: "templates/migrations/users_core_initial.cjs",
        toDir: "migrations",
        slug: "users_core_initial",
        extension: ".cjs",
        reason: "Install users/workspace core schema migration.",
        category: "migration",
        id: "users-core-initial-schema"
      }
    ],
    text: [
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.workspaceSwitching =",
        value:
          "\nconfig.tenancyMode = \"workspace\";\nconfig.workspaceSwitching = true;\nconfig.workspaceInvites = true;\nconfig.workspaceCreateEnabled = false;\nconfig.assistantEnabled = false;\nconfig.assistantRequiredPermission = \"\";\nconfig.socialEnabled = false;\nconfig.socialFederationEnabled = false;\nconfig.surfaceDefinitions = config.surfaceDefinitions || {};\nconst enabledSurfaceIds = Object.keys(config.surfaceDefinitions).filter(\n  (surfaceId) => config.surfaceDefinitions[surfaceId] && config.surfaceDefinitions[surfaceId].enabled !== false\n);\nconst preferredWorkspaceSurfaceIds = [\"app\", \"admin\"];\nfor (const surfaceId of preferredWorkspaceSurfaceIds) {\n  if (config.surfaceDefinitions[surfaceId] && config.surfaceDefinitions[surfaceId].enabled !== false) {\n    config.surfaceDefinitions[surfaceId].requiresWorkspace = true;\n  }\n}\nconst hasWorkspaceSurface = enabledSurfaceIds.some(\n  (surfaceId) => config.surfaceDefinitions[surfaceId] && config.surfaceDefinitions[surfaceId].requiresWorkspace === true\n);\nif (!hasWorkspaceSurface && enabledSurfaceIds.length > 0) {\n  config.surfaceDefinitions[enabledSurfaceIds[0]].requiresWorkspace = true;\n}\n",
        reason: "Append default public users/workspace feature toggles into app-owned config.",
        category: "users-core",
        id: "users-core-public-config"
      },
      {
        op: "append-text",
        file: "config/server.js",
        position: "bottom",
        skipIfContains: "config.workspaceColor =",
        value: "\nconfig.workspaceColor = \"indigo\";\n",
        reason: "Append default server-only users/workspace settings into app-owned config.",
        category: "users-core",
        id: "users-core-server-config"
      }
    ]
  }
});
