export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/billing-fastify-routes",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/billing-service-core",
    "@jskit-ai/http-contracts",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/billing-core"
  ],
  "capabilities": {
    "provides": [
      "billing.server-routes"
    ],
    "requires": [
      "billing.service",
      "contracts.http",
      "runtime.server",
      "billing.core"
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
          "method": "POST",
          "path": "/api/billing/checkout",
          "summary": "Create or replay a checkout session for the selected billable entity"
        },
        {
          "method": "GET",
          "path": "/api/billing/limitations",
          "summary": "Get effective billing limitations and quota usage for the selected billable entity"
        },
        {
          "method": "POST",
          "path": "/api/billing/payment-links",
          "summary": "Create or replay a payment link for one-off billing on the selected billable entity"
        },
        {
          "method": "GET",
          "path": "/api/billing/payment-methods",
          "summary": "List billing payment methods for the selected billable entity"
        },
        {
          "method": "DELETE",
          "path": "/api/billing/payment-methods/:paymentMethodId",
          "summary": "Remove a billing payment method for the selected billable entity"
        },
        {
          "method": "POST",
          "path": "/api/billing/payment-methods/:paymentMethodId/default",
          "summary": "Set the default billing payment method for the selected billable entity"
        },
        {
          "method": "POST",
          "path": "/api/billing/payment-methods/:paymentMethodId/detach",
          "summary": "Detach a billing payment method for the selected billable entity"
        },
        {
          "method": "POST",
          "path": "/api/billing/payment-methods/sync",
          "summary": "Synchronize billing payment methods for the selected billable entity"
        },
        {
          "method": "POST",
          "path": "/api/billing/plan-change",
          "summary": "Request a workspace core-plan change (immediate upgrade or scheduled downgrade)"
        },
        {
          "method": "POST",
          "path": "/api/billing/plan-change/cancel",
          "summary": "Cancel a pending scheduled core-plan downgrade"
        },
        {
          "method": "GET",
          "path": "/api/billing/plan-state",
          "summary": "Get current workspace billing plan state (current plan, expiry, and next scheduled plan)"
        },
        {
          "method": "GET",
          "path": "/api/billing/plans",
          "summary": "List active billing plans for the selected billable entity"
        },
        {
          "method": "POST",
          "path": "/api/billing/portal",
          "summary": "Create or replay a billing portal session for the selected billable entity"
        },
        {
          "method": "GET",
          "path": "/api/billing/products",
          "summary": "List active one-off billing products for the selected billable entity"
        },
        {
          "method": "GET",
          "path": "/api/billing/purchases",
          "summary": "List confirmed billing purchases for the selected billable entity"
        },
        {
          "method": "GET",
          "path": "/api/billing/timeline",
          "summary": "Get billing activity timeline for the selected billable entity"
        },
        {
          "method": "POST",
          "path": "/api/billing/webhooks/paddle",
          "summary": "Paddle webhook endpoint (raw body signature-verified)"
        },
        {
          "method": "POST",
          "path": "/api/billing/webhooks/stripe",
          "summary": "Stripe webhook endpoint (raw body signature-verified)"
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
        "@jskit-ai/billing-service-core": "0.1.0",
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
