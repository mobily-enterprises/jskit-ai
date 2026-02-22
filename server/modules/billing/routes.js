import { withStandardErrorResponses } from "../api/schema.js";
import { schema } from "./schema.js";
import { BILLING_RUNTIME_DEFAULTS } from "./constants.js";

function buildRoutes(controllers, { missingHandler } = {}) {
  return [
    {
      path: "/api/billing/plans",
      method: "GET",
      auth: "required",
      workspacePolicy: "optional",
      schema: {
        tags: ["billing"],
        summary: "List active billing plans for the selected billable entity",
        response: withStandardErrorResponses({
          200: schema.response.plans
        })
      },
      handler: controllers.billing?.listPlans || missingHandler
    },
    {
      path: "/api/billing/products",
      method: "GET",
      auth: "required",
      workspacePolicy: "optional",
      schema: {
        tags: ["billing"],
        summary: "List active one-off billing products for the selected billable entity",
        response: withStandardErrorResponses({
          200: schema.response.products
        })
      },
      handler: controllers.billing?.listProducts || missingHandler
    },
    {
      path: "/api/billing/purchases",
      method: "GET",
      auth: "required",
      workspacePolicy: "optional",
      schema: {
        tags: ["billing"],
        summary: "List confirmed billing purchases for the selected billable entity",
        response: withStandardErrorResponses({
          200: schema.response.purchases
        })
      },
      handler: controllers.billing?.listPurchases || missingHandler
    },
    {
      path: "/api/billing/plan-state",
      method: "GET",
      auth: "required",
      workspacePolicy: "optional",
      schema: {
        tags: ["billing"],
        summary: "Get current workspace billing plan state (current plan, expiry, and next scheduled plan)",
        response: withStandardErrorResponses({
          200: schema.response.planState
        })
      },
      handler: controllers.billing?.getPlanState || missingHandler
    },
    {
      path: "/api/billing/payment-methods",
      method: "GET",
      auth: "required",
      workspacePolicy: "optional",
      schema: {
        tags: ["billing"],
        summary: "List billing payment methods for the selected billable entity",
        response: withStandardErrorResponses({
          200: schema.response.paymentMethods
        })
      },
      handler: controllers.billing?.listPaymentMethods || missingHandler
    },
    {
      path: "/api/billing/payment-methods/sync",
      method: "POST",
      auth: "required",
      workspacePolicy: "optional",
      schema: {
        tags: ["billing"],
        summary: "Synchronize billing payment methods for the selected billable entity",
        response: withStandardErrorResponses({
          200: schema.response.paymentMethodSync
        })
      },
      handler: controllers.billing?.syncPaymentMethods || missingHandler
    },
    {
      path: "/api/billing/limitations",
      method: "GET",
      auth: "required",
      workspacePolicy: "optional",
      schema: {
        tags: ["billing"],
        summary: "Get effective billing limitations and quota usage for the selected billable entity",
        response: withStandardErrorResponses({
          200: schema.response.limitations
        })
      },
      handler: controllers.billing?.getLimitations || missingHandler
    },
    {
      path: "/api/billing/timeline",
      method: "GET",
      auth: "required",
      workspacePolicy: "optional",
      schema: {
        tags: ["billing"],
        summary: "Get billing activity timeline for the selected billable entity",
        querystring: schema.query.timeline,
        response: withStandardErrorResponses(
          {
            200: schema.response.timeline
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.billing?.getTimeline || missingHandler
    },
    {
      path: "/api/billing/checkout",
      method: "POST",
      auth: "required",
      workspacePolicy: "optional",
      schema: {
        tags: ["billing"],
        summary: "Create or replay a checkout session for the selected billable entity",
        body: schema.body.checkout,
        response: withStandardErrorResponses(
          {
            200: schema.response.checkout
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.billing?.startCheckout || missingHandler
    },
    {
      path: "/api/billing/plan-change",
      method: "POST",
      auth: "required",
      workspacePolicy: "optional",
      schema: {
        tags: ["billing"],
        summary: "Request a workspace core-plan change (immediate upgrade or scheduled downgrade)",
        body: schema.body.planChange,
        response: withStandardErrorResponses(
          {
            200: schema.response.planChange
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.billing?.requestPlanChange || missingHandler
    },
    {
      path: "/api/billing/plan-change/cancel",
      method: "POST",
      auth: "required",
      workspacePolicy: "optional",
      schema: {
        tags: ["billing"],
        summary: "Cancel a pending scheduled core-plan downgrade",
        response: withStandardErrorResponses({
          200: schema.response.planChangeCancel
        })
      },
      handler: controllers.billing?.cancelPendingPlanChange || missingHandler
    },
    {
      path: "/api/billing/portal",
      method: "POST",
      auth: "required",
      workspacePolicy: "optional",
      schema: {
        tags: ["billing"],
        summary: "Create or replay a billing portal session for the selected billable entity",
        body: schema.body.portal,
        response: withStandardErrorResponses(
          {
            200: schema.response.portal
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.billing?.createPortalSession || missingHandler
    },
    {
      path: "/api/billing/payment-links",
      method: "POST",
      auth: "required",
      workspacePolicy: "optional",
      schema: {
        tags: ["billing"],
        summary: "Create or replay a payment link for one-off billing on the selected billable entity",
        body: schema.body.paymentLink,
        response: withStandardErrorResponses(
          {
            200: schema.response.paymentLink
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.billing?.createPaymentLink || missingHandler
    },
    {
      path: "/api/billing/webhooks/stripe",
      method: "POST",
      auth: "public",
      workspacePolicy: "none",
      csrfProtection: false,
      bodyLimit: BILLING_RUNTIME_DEFAULTS.WEBHOOK_MAX_PAYLOAD_BYTES,
      schema: {
        tags: ["billing-webhooks"],
        summary: "Stripe webhook endpoint (raw body signature-verified)",
        response: withStandardErrorResponses({
          200: schema.response.webhook
        })
      },
      handler: controllers.billing?.processStripeWebhook || missingHandler
    },
    {
      path: "/api/billing/webhooks/paddle",
      method: "POST",
      auth: "public",
      workspacePolicy: "none",
      csrfProtection: false,
      bodyLimit: BILLING_RUNTIME_DEFAULTS.WEBHOOK_MAX_PAYLOAD_BYTES,
      schema: {
        tags: ["billing-webhooks"],
        summary: "Paddle webhook endpoint (raw body signature-verified)",
        response: withStandardErrorResponses({
          200: schema.response.webhook
        })
      },
      handler: controllers.billing?.processPaddleWebhook || missingHandler
    }
  ];
}

export { buildRoutes };
