export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/workspace-fastify-routes",
  "version": "0.1.0",
  "description": "Fastify controller/routes/schema wiring for workspace APIs.",
  "dependsOn": [
    "@jskit-ai/workspace-service-core",
    "@jskit-ai/access-core",
    "@jskit-ai/http-contracts",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/value-app-config-shared"
  ],
  "capabilities": {
    "provides": [
      "workspace.server-routes"
    ],
    "requires": [
      "workspace.service",
      "auth.access",
      "contracts.http",
      "runtime.server"
    ]
  },
  "runtime": {
    "server": {
      "entrypoint": "src/shared/server.js",
      "export": "createServerContributions"
    }
  },
  "metadata": {
    "server": {
      "routes": [
        {
          "method": "GET",
          "path": "/api/admin/workspace/ai/transcripts",
          "summary": "List AI transcript conversations for the active workspace"
        },
        {
          "method": "GET",
          "path": "/api/admin/workspace/ai/transcripts/:conversationId/export",
          "summary": "Export one AI transcript conversation for the active workspace"
        },
        {
          "method": "GET",
          "path": "/api/admin/workspace/ai/transcripts/:conversationId/messages",
          "summary": "List messages for one AI transcript conversation in the active workspace"
        },
        {
          "method": "GET",
          "path": "/api/admin/workspace/invites",
          "summary": "List pending invites for active workspace"
        },
        {
          "method": "POST",
          "path": "/api/admin/workspace/invites",
          "summary": "Create invite for active workspace"
        },
        {
          "method": "DELETE",
          "path": "/api/admin/workspace/invites/:inviteId",
          "summary": "Revoke pending invite in active workspace"
        },
        {
          "method": "GET",
          "path": "/api/admin/workspace/members",
          "summary": "List active members for active workspace"
        },
        {
          "method": "PATCH",
          "path": "/api/admin/workspace/members/:memberUserId/role",
          "summary": "Update member role in active workspace"
        },
        {
          "method": "GET",
          "path": "/api/admin/workspace/roles",
          "summary": "Get workspace role catalog"
        },
        {
          "method": "GET",
          "path": "/api/admin/workspace/settings",
          "summary": "Get active workspace settings and role catalog"
        },
        {
          "method": "PATCH",
          "path": "/api/admin/workspace/settings",
          "summary": "Update active workspace settings"
        },
        {
          "method": "GET",
          "path": "/api/bootstrap",
          "summary": "Get startup bootstrap payload with session, app, workspace, and settings context"
        },
        {
          "method": "GET",
          "path": "/api/workspace/invitations/pending",
          "summary": "List pending workspace invitations for authenticated user"
        },
        {
          "method": "POST",
          "path": "/api/workspace/invitations/redeem",
          "summary": "Accept or refuse a workspace invitation using an invite token"
        },
        {
          "method": "GET",
          "path": "/api/workspaces",
          "summary": "List workspaces visible to authenticated user"
        },
        {
          "method": "POST",
          "path": "/api/workspaces/select",
          "summary": "Select active workspace by slug or id"
        }
      ]
    },
    "ui": {
      "elements": []
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@fastify/type-provider-typebox": "^6.1.0",
        "@jskit-ai/access-core": "0.1.0",
        "@jskit-ai/http-contracts": "0.1.0",
        "@jskit-ai/server-runtime-core": "0.1.0"
      },
      "dev": {}
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": []
  }
});
