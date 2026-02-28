export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/billing-provider-paddle",
  "version": "0.1.0",
  "options": {
    "billing-paddle-api-key": {
      "required": true,
      "values": [],
      "promptLabel": "Paddle API key",
      "promptHint": "Paddle API key"
    },
    "billing-paddle-webhook-endpoint-secret": {
      "required": true,
      "values": [],
      "promptLabel": "Paddle webhook secret",
      "promptHint": "Paddle webhook signing secret"
    }
  },
  "dependsOn": [
    "@jskit-ai/billing-provider-core",
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "billing.provider",
      "billing.provider.paddle"
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
        "@jskit-ai/server-runtime-core": "0.1.0"
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
        "key": "BILLING_PADDLE_API_KEY",
        "value": "${option:billing-paddle-api-key}",
        "reason": "Configure Paddle API key.",
        "category": "runtime-config",
        "id": "billing-paddle-api-key"
      },
      {
        "file": ".env",
        "op": "upsert-env",
        "key": "BILLING_PADDLE_WEBHOOK_ENDPOINT_SECRET",
        "value": "${option:billing-paddle-webhook-endpoint-secret}",
        "reason": "Configure Paddle webhook signing secret.",
        "category": "runtime-config",
        "id": "billing-paddle-webhook-endpoint-secret"
      }
    ]
  }
});
