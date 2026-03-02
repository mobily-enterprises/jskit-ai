export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/assistant-client-element",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/assistant-client-runtime"
  ],
  "capabilities": {
    "provides": [
      "assistant.client-element"
    ],
    "requires": [
      "assistant.client-runtime"
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
          "id": "assistant-client",
          "name": "assistant.client-element",
          "capability": "assistant.client-element",
          "purpose": "Assistant conversation UI surface.",
          "surface": "app",
          "availability": {
            "import": {
              "module": "@jskit-ai/assistant-client-element",
              "symbols": [
                "AssistantClientElement"
              ]
            }
          },
          "pathOptions": [
            {
              "option": "assistant-page-path",
              "defaultValue": "assistant",
              "promptLabel": "Assistant page path",
              "promptHint": "Relative path under src/pages/app"
            }
          ],
          "contributions": {
            "clientRoutes": [
              {
                "path": "/${option:assistant-page-path}",
                "surface": "app",
                "name": "assistant",
                "purpose": "Assistant page route contribution."
              }
            ],
            "shellEntries": [
              {
                "surface": "app",
                "slot": "drawer",
                "id": "app-assistant",
                "title": "Assistant",
                "route": "/${option:assistant-page-path}",
                "icon": "$assistant",
                "order": 30
              }
            ],
            "files": [
              {
                "from": "templates/src/pages/app/assistant/index.vue",
                "to": "src/pages/app/${option:assistant-page-path}/index.vue",
                "reason": "Materialize assistant placeholder page.",
                "category": "ui-page",
                "id": "assistant-page"
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
