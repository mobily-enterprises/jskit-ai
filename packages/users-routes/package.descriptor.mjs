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
          path: "/api/<workspace-surface-prefix>/w/:workspaceSlug/workspace/settings",
          summary: "Get workspace settings and role catalog by workspace slug."
        },
        {
          method: "PATCH",
          path: "/api/<workspace-surface-prefix>/w/:workspaceSlug/workspace/settings",
          summary: "Update workspace settings by workspace slug."
        },
        {
          method: "GET",
          path: "/api/<workspace-surface-prefix>/w/:workspaceSlug/workspace/roles",
          summary: "Get workspace role catalog by workspace slug."
        },
        {
          method: "GET",
          path: "/api/<workspace-surface-prefix>/w/:workspaceSlug/workspace/members",
          summary: "List members by workspace slug."
        },
        {
          method: "PATCH",
          path: "/api/<workspace-surface-prefix>/w/:workspaceSlug/workspace/members/:memberUserId/role",
          summary: "Update workspace member role by workspace slug."
        },
        {
          method: "GET",
          path: "/api/<workspace-surface-prefix>/w/:workspaceSlug/workspace/invites",
          summary: "List workspace invites by workspace slug."
        },
        {
          method: "POST",
          path: "/api/<workspace-surface-prefix>/w/:workspaceSlug/workspace/invites",
          summary: "Create workspace invite by workspace slug."
        },
        {
          method: "DELETE",
          path: "/api/<workspace-surface-prefix>/w/:workspaceSlug/workspace/invites/:inviteId",
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
