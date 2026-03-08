export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/users-routes",
  version: "0.1.0",
  description: "Fastify transport adapter for users/workspace/settings HTTP routes.",
  dependsOn: [
    "@jskit-ai/users-core",
    "@jskit-ai/http-runtime",
    "@jskit-ai/auth-core"
  ],
  capabilities: {
    provides: [
      "users.server-routes"
    ],
    requires: [
      "users.core",
      "runtime.actions",
      "auth.policy"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/providers/UsersRouteServiceProvider.js",
          export: "UsersRouteServiceProvider"
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
          summary: "Exports users workspace/settings controllers, schema modules, route builders, and UsersRouteServiceProvider."
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
          path: "/api/bootstrap",
          summary: "Get bootstrap payload with profile/workspace context."
        },
        {
          method: "GET",
          path: "/api/workspaces",
          summary: "List workspaces visible to authenticated user."
        },
        {
          method: "POST",
          path: "/api/workspaces/select",
          summary: "Select active workspace by slug or id."
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
          path: "/api/admin/workspace/settings",
          summary: "Get active workspace settings and role catalog."
        },
        {
          method: "PATCH",
          path: "/api/admin/workspace/settings",
          summary: "Update active workspace settings."
        },
        {
          method: "GET",
          path: "/api/admin/workspace/roles",
          summary: "Get workspace role catalog."
        },
        {
          method: "GET",
          path: "/api/admin/workspace/members",
          summary: "List active members for active workspace."
        },
        {
          method: "PATCH",
          path: "/api/admin/workspace/members/:memberUserId/role",
          summary: "Update member role in active workspace."
        },
        {
          method: "GET",
          path: "/api/admin/workspace/invites",
          summary: "List pending invites for active workspace."
        },
        {
          method: "POST",
          path: "/api/admin/workspace/invites",
          summary: "Create invite for active workspace."
        },
        {
          method: "DELETE",
          path: "/api/admin/workspace/invites/:inviteId",
          summary: "Revoke pending invite in active workspace."
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
          method: "PATCH",
          path: "/api/settings/chat",
          summary: "Update chat settings."
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
        "@fastify/type-provider-typebox": "^6.1.0",
        "@jskit-ai/auth-core": "0.1.0",
        "@jskit-ai/http-runtime": "0.1.0",
        "@jskit-ai/kernel": "0.1.0",
        "@jskit-ai/users-core": "0.1.0"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: []
  }
});
