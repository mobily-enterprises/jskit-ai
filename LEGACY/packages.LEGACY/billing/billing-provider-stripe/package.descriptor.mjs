export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/billing-provider-stripe",
  "version": "0.1.0",
  "options": {
    "billing-stripe-secret-key": {
      "required": true,
      "values": [],
      "promptLabel": "Stripe secret key",
      "promptHint": "sk_live_..."
    },
    "billing-stripe-api-version": {
      "required": true,
      "values": [],
      "promptLabel": "Stripe API version",
      "promptHint": "2024-06-20"
    },
    "billing-stripe-webhook-endpoint-secret": {
      "required": true,
      "values": [],
      "promptLabel": "Stripe webhook secret",
      "promptHint": "whsec_..."
    }
  },
  "dependsOn": [
    "@jskit-ai/billing-provider-core",
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "billing.provider",
      "billing.provider.stripe"
    ],
    "requires": [
      "billing.provider-contract",
      "runtime.server"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/billing-provider-core": "0.1.0",
        "@jskit-ai/server-runtime-core": "0.1.0",
        "stripe": "^14.25.0"
      },
      "dev": {}
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": [],
    "text": [
      {
        "file": ".env",
        "op": "upsert-env",
        "key": "BILLING_STRIPE_SECRET_KEY",
        "value": "${option:billing-stripe-secret-key}",
        "reason": "Configure Stripe API secret key.",
        "category": "runtime-config",
        "id": "billing-stripe-secret-key"
      },
      {
        "file": ".env",
        "op": "upsert-env",
        "key": "BILLING_STRIPE_API_VERSION",
        "value": "${option:billing-stripe-api-version}",
        "reason": "Configure Stripe API version.",
        "category": "runtime-config",
        "id": "billing-stripe-api-version"
      },
      {
        "file": ".env",
        "op": "upsert-env",
        "key": "BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET",
        "value": "${option:billing-stripe-webhook-endpoint-secret}",
        "reason": "Configure Stripe webhook signing secret.",
        "category": "runtime-config",
        "id": "billing-stripe-webhook-endpoint-secret"
      }
    ]
  }
});
