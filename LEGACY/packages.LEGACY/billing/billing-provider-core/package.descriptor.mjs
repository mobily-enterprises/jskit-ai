export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/billing-provider-core",
  "version": "0.1.0",
  "description": "Billing provider adapter/webhook contracts and provider registry primitives.",
  "options": {
    "billing-operation-key-secret": {
      "required": true,
      "values": [],
      "promptLabel": "Billing operation key secret",
      "promptHint": "High-entropy HMAC secret"
    },
    "billing-provider-idempotency-key-secret": {
      "required": true,
      "values": [],
      "promptLabel": "Billing idempotency key secret",
      "promptHint": "High-entropy HMAC secret"
    }
  },
  "dependsOn": [],
  "capabilities": {
    "provides": [
      "billing.provider-contract",
      "billing.provider-registry"
    ],
    "requires": []
  },
  "mutations": {
    "dependencies": {
      "runtime": {},
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
        "key": "BILLING_OPERATION_KEY_SECRET",
        "value": "${option:billing-operation-key-secret}",
        "reason": "Set billing operation key HMAC secret.",
        "category": "runtime-config",
        "id": "billing-operation-key-secret"
      },
      {
        "file": ".env",
        "op": "upsert-env",
        "key": "BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET",
        "value": "${option:billing-provider-idempotency-key-secret}",
        "reason": "Set billing provider idempotency key HMAC secret.",
        "category": "runtime-config",
        "id": "billing-provider-idempotency-key-secret"
      }
    ]
  }
});
