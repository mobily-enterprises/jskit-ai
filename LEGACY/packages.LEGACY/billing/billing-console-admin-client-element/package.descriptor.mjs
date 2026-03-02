export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/billing-console-admin-client-element",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/billing-core"
  ],
  "capabilities": {
    "provides": [
      "billing.console.admin.client"
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
          "id": "billing-console-admin",
          "name": "billing.console.admin.client",
          "capability": "billing.console.admin.client",
          "purpose": "Console billing plans/products administration UI surface.",
          "surface": "admin",
          "availability": {
            "import": {
              "module": "@jskit-ai/billing-console-admin-client-element",
              "symbols": [
                "ConsoleBillingPlansClientElement",
                "ConsoleBillingProductsClientElement"
              ]
            }
          },
          "pathOptions": [
            {
              "option": "billing-console-plans-page-path",
              "defaultValue": "billing/plans",
              "promptLabel": "Billing console plans page path",
              "promptHint": "Relative path under src/pages/admin"
            },
            {
              "option": "billing-console-products-page-path",
              "defaultValue": "billing/products",
              "promptLabel": "Billing console products page path",
              "promptHint": "Relative path under src/pages/admin"
            }
          ],
          "contributions": {
            "clientRoutes": [
              {
                "path": "/${option:billing-console-plans-page-path}",
                "surface": "admin",
                "name": "billing-console-plans",
                "purpose": "Console billing plans route contribution."
              },
              {
                "path": "/${option:billing-console-products-page-path}",
                "surface": "admin",
                "name": "billing-console-products",
                "purpose": "Console billing products route contribution."
              }
            ],
            "shellEntries": [
              {
                "surface": "admin",
                "slot": "drawer",
                "id": "admin-billing-plans",
                "title": "Billing plans",
                "route": "/${option:billing-console-plans-page-path}",
                "icon": "$billingPlan",
                "order": 48
              },
              {
                "surface": "admin",
                "slot": "config",
                "id": "admin-billing-products",
                "title": "Billing products",
                "route": "/${option:billing-console-products-page-path}",
                "icon": "$billingProducts",
                "order": 49
              }
            ],
            "files": [
              {
                "from": "templates/src/pages/admin/billing-console-plans/index.vue",
                "to": "src/pages/admin/${option:billing-console-plans-page-path}/index.vue",
                "reason": "Materialize console billing plans placeholder page.",
                "category": "ui-page",
                "id": "billing-console-plans-page"
              },
              {
                "from": "templates/src/pages/admin/billing-console-products/index.vue",
                "to": "src/pages/admin/${option:billing-console-products-page-path}/index.vue",
                "reason": "Materialize console billing products placeholder page.",
                "category": "ui-page",
                "id": "billing-console-products-page"
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
        "@koumoul/vjsf": "^3.26.1",
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
