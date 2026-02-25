import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { schema } from "./schema.js";

function buildRoutes(controllers, { missingHandler }) {
  return [
    {
      path: "/api/console/bootstrap",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "Get console-surface bootstrap payload for authenticated user",
        response: withStandardErrorResponses({
          200: schema.response.bootstrap
        })
      },
      handler: controllers.console?.bootstrap || missingHandler
    },
    {
      path: "/api/console/roles",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "Get console role catalog",
        response: withStandardErrorResponses({
          200: schema.response.roles
        })
      },
      handler: controllers.console?.listRoles || missingHandler
    },
    {
      path: "/api/console/settings",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "Get console assistant settings",
        response: withStandardErrorResponses({
          200: schema.response.assistantSettings
        })
      },
      handler: controllers.console?.getAssistantSettings || missingHandler
    },
    {
      path: "/api/console/settings",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "Update console assistant settings",
        body: schema.body.assistantSettingsUpdate,
        response: withStandardErrorResponses(
          {
            200: schema.response.assistantSettings
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.updateAssistantSettings || missingHandler
    },
    {
      path: "/api/console/members",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "List active console members",
        response: withStandardErrorResponses({
          200: schema.response.members
        })
      },
      handler: controllers.console?.listMembers || missingHandler
    },
    {
      path: "/api/console/members/:memberUserId/role",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "Update console member role",
        params: schema.params.member,
        body: schema.body.memberRoleUpdate,
        response: withStandardErrorResponses(
          {
            200: schema.response.members
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.updateMemberRole || missingHandler
    },
    {
      path: "/api/console/invites",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "List pending console invites",
        response: withStandardErrorResponses({
          200: schema.response.invites
        })
      },
      handler: controllers.console?.listInvites || missingHandler
    },
    {
      path: "/api/console/ai/transcripts",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-ai-transcripts"],
        summary: "List AI transcript conversations across workspaces",
        querystring: schema.query.aiTranscripts,
        response: withStandardErrorResponses(
          {
            200: schema.response.aiTranscriptsList
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.listAiTranscripts || missingHandler
    },
    {
      path: "/api/console/billing/plans",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "List billing catalog plans for the active billing provider",
        response: withStandardErrorResponses({
          200: schema.response.billingPlans
        })
      },
      handler: controllers.console?.listBillingPlans || missingHandler
    },
    {
      path: "/api/console/billing/products",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "List billing catalog products for the active billing provider",
        response: withStandardErrorResponses({
          200: schema.response.billingProducts
        })
      },
      handler: controllers.console?.listBillingProducts || missingHandler
    },
    {
      path: "/api/console/billing/purchases",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "List billing purchases across workspaces/entities for console operations",
        querystring: schema.query.billingPurchases,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingPurchases
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.listBillingPurchases || missingHandler
    },
    {
      path: "/api/console/billing/purchases/:purchaseId/refund",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "Refund a billing purchase with idempotent console command semantics",
        params: schema.params.billingPurchase,
        body: schema.body.billingPurchaseMutation,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingPurchaseMutation
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.refundBillingPurchase || missingHandler
    },
    {
      path: "/api/console/billing/purchases/:purchaseId/void",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "Void a billing purchase with idempotent console command semantics",
        params: schema.params.billingPurchase,
        body: schema.body.billingPurchaseMutation,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingPurchaseMutation
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.voidBillingPurchase || missingHandler
    },
    {
      path: "/api/console/billing/purchases/:purchaseId/corrections",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "Record a billing purchase correction entry",
        params: schema.params.billingPurchase,
        body: schema.body.billingPurchaseCorrectionCreate,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingPurchaseMutation
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.createBillingPurchaseCorrection || missingHandler
    },
    {
      path: "/api/console/billing/plan-assignments",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "List billing plan assignments across entities for console operations",
        querystring: schema.query.billingPlanAssignments,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingPlanAssignments
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.listBillingPlanAssignments || missingHandler
    },
    {
      path: "/api/console/billing/plan-assignments",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "Create a plan assignment for a target billable entity",
        body: schema.body.billingPlanAssignmentCreate,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingPlanAssignmentMutation
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.createBillingPlanAssignment || missingHandler
    },
    {
      path: "/api/console/billing/plan-assignments/:assignmentId",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "Update a plan assignment for a target billable entity",
        params: schema.params.billingPlanAssignment,
        body: schema.body.billingPlanAssignmentUpdate,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingPlanAssignmentMutation
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.updateBillingPlanAssignment || missingHandler
    },
    {
      path: "/api/console/billing/plan-assignments/:assignmentId/cancel",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "Cancel a plan assignment for a target billable entity",
        params: schema.params.billingPlanAssignment,
        body: schema.body.billingPlanAssignmentCancel,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingPlanAssignmentMutation
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.cancelBillingPlanAssignment || missingHandler
    },
    {
      path: "/api/console/billing/subscriptions",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "List provider subscriptions across entities for console operations",
        querystring: schema.query.billingSubscriptions,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingSubscriptions
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.listBillingSubscriptions || missingHandler
    },
    {
      path: "/api/console/billing/subscriptions/:providerSubscriptionId/change-plan",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "Change provider subscription plan mapping",
        params: schema.params.billingSubscription,
        body: schema.body.billingSubscriptionChangePlan,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingSubscriptionMutation
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.changeBillingSubscriptionPlan || missingHandler
    },
    {
      path: "/api/console/billing/subscriptions/:providerSubscriptionId/cancel",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "Cancel a provider subscription immediately",
        params: schema.params.billingSubscription,
        body: schema.body.billingSubscriptionCancel,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingSubscriptionMutation
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.cancelBillingSubscription || missingHandler
    },
    {
      path: "/api/console/billing/subscriptions/:providerSubscriptionId/cancel-at-period-end",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "Set provider subscription to cancel at current period end",
        params: schema.params.billingSubscription,
        body: schema.body.billingSubscriptionCancelAtPeriodEnd,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingSubscriptionMutation
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.cancelBillingSubscriptionAtPeriodEnd || missingHandler
    },
    {
      path: "/api/console/billing/entitlement-definitions",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "List entitlement definitions available to console billing catalog management",
        response: withStandardErrorResponses({
          200: schema.response.billingEntitlementDefinitions
        })
      },
      handler: controllers.console?.listBillingEntitlementDefinitions || missingHandler
    },
    {
      path: "/api/console/billing/entitlement-definitions/:definitionId",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "Get one entitlement definition by id",
        params: schema.params.billingEntitlementDefinition,
        response: withStandardErrorResponses({
          200: schema.response.billingEntitlementDefinition
        })
      },
      handler: controllers.console?.getBillingEntitlementDefinition || missingHandler
    },
    {
      path: "/api/console/billing/settings",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "Get console billing behavior settings",
        response: withStandardErrorResponses({
          200: schema.response.billingSettings
        })
      },
      handler: controllers.console?.getBillingSettings || missingHandler
    },
    {
      path: "/api/console/billing/settings",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "Update console billing behavior settings",
        body: schema.body.billingSettingsUpdate,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingSettings
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.updateBillingSettings || missingHandler
    },
    {
      path: "/api/console/billing/provider-prices",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "List active provider prices available for plan configuration",
        querystring: schema.query.billingProviderPrices,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingProviderPrices
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.listBillingProviderPrices || missingHandler
    },
    {
      path: "/api/console/billing/plans",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "Create billing catalog plan with one core recurring price mapping",
        body: schema.body.billingPlanCreate,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingPlanCreate
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.createBillingPlan || missingHandler
    },
    {
      path: "/api/console/billing/products",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "Create billing catalog product with one provider price mapping",
        body: schema.body.billingProductCreate,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingProductCreate
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.createBillingProduct || missingHandler
    },
    {
      path: "/api/console/billing/plans/:planId",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "Update an existing billing plan core price mapping",
        params: schema.params.billingPlan,
        body: schema.body.billingPlanUpdate,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingPlanUpdate
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.updateBillingPlan || missingHandler
    },
    {
      path: "/api/console/billing/products/:productId",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "Update an existing billing product price mapping",
        params: schema.params.billingProduct,
        body: schema.body.billingProductUpdate,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingProductUpdate
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.updateBillingProduct || missingHandler
    },
    {
      path: "/api/console/billing/events",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-billing"],
        summary: "List technical billing activity events across workspaces/entities",
        querystring: schema.query.billingEvents,
        response: withStandardErrorResponses(
          {
            200: schema.response.billingEvents
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.listBillingEvents || missingHandler
    },
    {
      path: "/api/console/ai/transcripts/:conversationId/messages",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-ai-transcripts"],
        summary: "List messages for one AI transcript conversation",
        params: schema.params.conversation,
        querystring: schema.query.aiTranscriptMessages,
        response: withStandardErrorResponses(
          {
            200: schema.response.aiTranscriptMessages
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.getAiTranscriptMessages || missingHandler
    },
    {
      path: "/api/console/ai/transcripts/export",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-ai-transcripts"],
        summary: "Export AI transcript messages across workspaces",
        querystring: schema.query.aiTranscriptExport,
        response: withStandardErrorResponses(
          {
            200: schema.response.aiTranscriptExport
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.exportAiTranscripts || missingHandler
    },
    {
      path: "/api/console/invites",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "Create console invite",
        body: schema.body.createInvite,
        response: withStandardErrorResponses(
          {
            200: schema.response.invites
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.console?.createInvite || missingHandler
    },
    {
      path: "/api/console/invites/:inviteId",
      method: "DELETE",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "Revoke pending console invite",
        params: schema.params.invite,
        response: withStandardErrorResponses({
          200: schema.response.invites
        })
      },
      handler: controllers.console?.revokeInvite || missingHandler
    },
    {
      path: "/api/console/invitations/pending",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "List pending console invitations for authenticated user",
        response: withStandardErrorResponses({
          200: schema.response.pendingInvites
        })
      },
      handler: controllers.console?.listPendingInvites || missingHandler
    },
    {
      path: "/api/console/invitations/redeem",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["console"],
        summary: "Accept or refuse a console invitation",
        body: schema.body.redeemInvite,
        response: withStandardErrorResponses(
          {
            200: schema.response.respondToInvite
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.console?.respondToPendingInviteByToken || missingHandler
    }
  ];
}

export { buildRoutes };
