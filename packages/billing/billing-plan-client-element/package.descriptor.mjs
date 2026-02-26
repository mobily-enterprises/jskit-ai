export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/billing-plan-client-element",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/billing-core"
  ],
  "capabilities": {
    "provides": [
      "billing.plan.client"
    ],
    "requires": [
      "billing.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "vue": "^3.5.13"
      },
      "dev": {
        "@vitejs/plugin-vue": "^5.2.1",
        "@vue/test-utils": "^2.4.6",
        "vite": "^6.1.0",
        "vitest": "^4.0.18"
      }
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": []
  }
});
