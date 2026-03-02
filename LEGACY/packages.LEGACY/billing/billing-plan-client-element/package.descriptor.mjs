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
  "metadata": {
    "server": {
      "routes": []
    },
    "ui": {
      "routes": [],
      "elements": [
        {
          "id": "billing-plan",
          "name": "billing.plan.client",
          "capability": "billing.plan.client",
          "purpose": "Billing plan management UI surface.",
          "surface": "app",
          "availability": {
            "import": {
              "module": "@jskit-ai/billing-plan-client-element",
              "symbols": [
                "BillingPlanClientElement"
              ]
            }
          },
          "pathOptions": [
            {
              "option": "billing-plan-app-page-path",
              "defaultValue": "billing/plans",
              "promptLabel": "Billing app plan page path",
              "promptHint": "Relative path under src/pages/app"
            },
            {
              "option": "billing-plan-admin-page-path",
              "defaultValue": "billing/plan",
              "promptLabel": "Billing admin plan page path",
              "promptHint": "Relative path under src/pages/admin"
            }
          ],
          "contributions": {
            "clientRoutes": [
              {
                "path": "/${option:billing-plan-app-page-path}",
                "surface": "app",
                "name": "billing-plan-app",
                "purpose": "Billing plan route on app surface."
              },
              {
                "path": "/${option:billing-plan-admin-page-path}",
                "surface": "admin",
                "name": "billing-plan-admin",
                "purpose": "Billing plan route on admin surface."
              }
            ],
            "shellEntries": [
              {
                "surface": "app",
                "slot": "drawer",
                "id": "app-billing-plan",
                "title": "Plan",
                "route": "/${option:billing-plan-app-page-path}",
                "icon": "$billingPlan",
                "order": 47
              },
              {
                "surface": "admin",
                "slot": "config",
                "id": "admin-billing-plan",
                "title": "Billing plan",
                "route": "/${option:billing-plan-admin-page-path}",
                "icon": "$billingPlan",
                "order": 40
              }
            ],
            "files": [
              {
                "from": "templates/src/pages/app/billing-plan/index.vue",
                "to": "src/pages/app/${option:billing-plan-app-page-path}/index.vue",
                "reason": "Materialize billing plan placeholder page for app surface.",
                "category": "ui-page",
                "id": "billing-plan-app-page"
              },
              {
                "from": "templates/src/pages/admin/billing-plan/index.vue",
                "to": "src/pages/admin/${option:billing-plan-admin-page-path}/index.vue",
                "reason": "Materialize billing plan placeholder page for admin surface.",
                "category": "ui-page",
                "id": "billing-plan-admin-page"
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
