import { withStandardErrorResponses } from "../api/schema.js";
import { schema } from "./schema.js";
import { STRIPE_PHASE1_DEFAULTS } from "./constants.js";

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
      path: "/api/billing/subscription",
      method: "GET",
      auth: "required",
      workspacePolicy: "optional",
      schema: {
        tags: ["billing"],
        summary: "Get billing snapshot for the selected billable entity",
        response: withStandardErrorResponses({
          200: schema.response.subscription
        })
      },
      handler: controllers.billing?.getSubscriptionSnapshot || missingHandler
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
        summary: "Synchronize billing payment methods from Stripe for the selected billable entity",
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
        summary: "Create or replay a Stripe checkout session for the selected billable entity",
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
      path: "/api/billing/portal",
      method: "POST",
      auth: "required",
      workspacePolicy: "optional",
      schema: {
        tags: ["billing"],
        summary: "Create or replay a Stripe billing portal session for the selected billable entity",
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
        summary: "Create or replay a Stripe payment link for one-off billing on the selected billable entity",
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
      bodyLimit: STRIPE_PHASE1_DEFAULTS.WEBHOOK_MAX_PAYLOAD_BYTES,
      schema: {
        tags: ["billing-webhooks"],
        summary: "Stripe webhook endpoint (raw body signature-verified)",
        response: withStandardErrorResponses({
          200: schema.response.webhook
        })
      },
      handler: controllers.billing?.processStripeWebhook || missingHandler
    }
  ];
}

export { buildRoutes };
