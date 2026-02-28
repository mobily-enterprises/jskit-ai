export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/billing-commerce-client-element",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/billing-core"
  ],
  "capabilities": {
    "provides": [
      "billing.commerce.client"
    ],
    "requires": [
      "billing.core"
    ]
  },
  "metadata": {
    "server": {
      "routes": []
    },
    "ui": {
      "routes": [],
      "elements": [
        {
          "id": "billing-commerce",
          "name": "billing.commerce.client",
          "capability": "billing.commerce.client",
          "purpose": "Billing commerce UI surface.",
          "surface": "app",
          "availability": {
            "import": {
              "module": "@jskit-ai/billing-commerce-client-element",
              "symbols": [
                "BillingCommerceClientElement"
              ]
            }
          },
          "pathOptions": [
            {
              "option": "billing-commerce-page-path",
              "defaultValue": "billing/commerce",
              "promptLabel": "Billing commerce page path",
              "promptHint": "Relative path under src/pages/app"
            }
          ],
          "contributions": {
            "clientRoutes": [
              {
                "path": "/${option:billing-commerce-page-path}",
                "surface": "app",
                "name": "billing-commerce",
                "purpose": "Billing commerce route contribution."
              }
            ],
            "shellEntries": [
              {
                "surface": "app",
                "slot": "drawer",
                "id": "app-billing-commerce",
                "title": "Billing",
                "route": "/${option:billing-commerce-page-path}",
                "icon": "$billing",
                "order": 45
              },
              {
                "surface": "app",
                "slot": "top",
                "id": "app-billing-commerce-top",
                "title": "Billing",
                "route": "/${option:billing-commerce-page-path}",
                "icon": "$billing",
                "order": 70
              }
            ],
            "files": [
              {
                "from": "templates/src/pages/app/billing-commerce/index.vue",
                "to": "src/pages/app/${option:billing-commerce-page-path}/index.vue",
                "reason": "Materialize billing commerce placeholder page.",
                "category": "ui-page",
                "id": "billing-commerce-page"
              }
            ],
            "text": []
          }
        }
      ]
    }
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
