export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/console-fastify-routes",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/access-core",
    "@jskit-ai/http-contracts",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/workspace-console-core",
    "@jskit-ai/value-app-config-shared"
  ],
  "capabilities": {
    "provides": [
      "workspace.console.server-routes"
    ],
    "requires": [
      "auth.access",
      "contracts.http",
      "runtime.server",
      "workspace.console.core"
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
          "path": "/api/console/ai/transcripts",
          "summary": "List AI transcript conversations across workspaces"
        },
        {
          "method": "GET",
          "path": "/api/console/ai/transcripts/:conversationId/messages",
          "summary": "List messages for one AI transcript conversation"
        },
        {
          "method": "GET",
          "path": "/api/console/ai/transcripts/export",
          "summary": "Export AI transcript messages across workspaces"
        },
        {
          "method": "GET",
          "path": "/api/console/billing/entitlement-definitions",
          "summary": "List entitlement definitions available to console billing catalog management"
        },
        {
          "method": "GET",
          "path": "/api/console/billing/entitlement-definitions/:definitionId",
          "summary": "Get one entitlement definition by id"
        },
        {
          "method": "GET",
          "path": "/api/console/billing/events",
          "summary": "List technical billing activity events across workspaces/entities"
        },
        {
          "method": "GET",
          "path": "/api/console/billing/plan-assignments",
          "summary": "List billing plan assignments across entities for console operations"
        },
        {
          "method": "POST",
          "path": "/api/console/billing/plan-assignments",
          "summary": "Create a plan assignment for a target billable entity"
        },
        {
          "method": "PATCH",
          "path": "/api/console/billing/plan-assignments/:assignmentId",
          "summary": "Update a plan assignment for a target billable entity"
        },
        {
          "method": "POST",
          "path": "/api/console/billing/plan-assignments/:assignmentId/cancel",
          "summary": "Cancel a plan assignment for a target billable entity"
        },
        {
          "method": "GET",
          "path": "/api/console/billing/plans",
          "summary": "List billing catalog plans for the active billing provider"
        },
        {
          "method": "POST",
          "path": "/api/console/billing/plans",
          "summary": "Create billing catalog plan with one core recurring price mapping"
        },
        {
          "method": "PATCH",
          "path": "/api/console/billing/plans/:planId",
          "summary": "Update an existing billing plan core price mapping"
        },
        {
          "method": "GET",
          "path": "/api/console/billing/products",
          "summary": "List billing catalog products for the active billing provider"
        },
        {
          "method": "POST",
          "path": "/api/console/billing/products",
          "summary": "Create billing catalog product with one provider price mapping"
        },
        {
          "method": "PATCH",
          "path": "/api/console/billing/products/:productId",
          "summary": "Update an existing billing product price mapping"
        },
        {
          "method": "GET",
          "path": "/api/console/billing/provider-prices",
          "summary": "List active provider prices available for plan configuration"
        },
        {
          "method": "GET",
          "path": "/api/console/billing/purchases",
          "summary": "List billing purchases across workspaces/entities for console operations"
        },
        {
          "method": "POST",
          "path": "/api/console/billing/purchases/:purchaseId/corrections",
          "summary": "Record a billing purchase correction entry"
        },
        {
          "method": "POST",
          "path": "/api/console/billing/purchases/:purchaseId/refund",
          "summary": "Refund a billing purchase with idempotent console command semantics"
        },
        {
          "method": "POST",
          "path": "/api/console/billing/purchases/:purchaseId/void",
          "summary": "Void a billing purchase with idempotent console command semantics"
        },
        {
          "method": "GET",
          "path": "/api/console/billing/settings",
          "summary": "Get console billing behavior settings"
        },
        {
          "method": "PATCH",
          "path": "/api/console/billing/settings",
          "summary": "Update console billing behavior settings"
        },
        {
          "method": "GET",
          "path": "/api/console/billing/subscriptions",
          "summary": "List provider subscriptions across entities for console operations"
        },
        {
          "method": "POST",
          "path": "/api/console/billing/subscriptions/:providerSubscriptionId/cancel",
          "summary": "Cancel a provider subscription immediately"
        },
        {
          "method": "POST",
          "path": "/api/console/billing/subscriptions/:providerSubscriptionId/cancel-at-period-end",
          "summary": "Set provider subscription to cancel at current period end"
        },
        {
          "method": "POST",
          "path": "/api/console/billing/subscriptions/:providerSubscriptionId/change-plan",
          "summary": "Change provider subscription plan mapping"
        },
        {
          "method": "GET",
          "path": "/api/console/bootstrap",
          "summary": "Get console-surface bootstrap payload for authenticated user"
        },
        {
          "method": "GET",
          "path": "/api/console/invitations/pending",
          "summary": "List pending console invitations for authenticated user"
        },
        {
          "method": "POST",
          "path": "/api/console/invitations/redeem",
          "summary": "Accept or refuse a console invitation"
        },
        {
          "method": "GET",
          "path": "/api/console/invites",
          "summary": "List pending console invites"
        },
        {
          "method": "POST",
          "path": "/api/console/invites",
          "summary": "Create console invite"
        },
        {
          "method": "DELETE",
          "path": "/api/console/invites/:inviteId",
          "summary": "Revoke pending console invite"
        },
        {
          "method": "GET",
          "path": "/api/console/members",
          "summary": "List active console members"
        },
        {
          "method": "PATCH",
          "path": "/api/console/members/:memberUserId/role",
          "summary": "Update console member role"
        },
        {
          "method": "GET",
          "path": "/api/console/roles",
          "summary": "Get console role catalog"
        },
        {
          "method": "GET",
          "path": "/api/console/settings",
          "summary": "Get console assistant settings"
        },
        {
          "method": "PATCH",
          "path": "/api/console/settings",
          "summary": "Update console assistant settings"
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
