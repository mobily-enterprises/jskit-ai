export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/chat-client-element",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/chat-client-runtime"
  ],
  "capabilities": {
    "provides": [
      "chat.client-element"
    ],
    "requires": [
      "chat.client-runtime"
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
          "id": "chat-client",
          "name": "chat.client-element",
          "capability": "chat.client-element",
          "purpose": "Workspace chat client UI element.",
          "surface": "app",
          "availability": {
            "import": {
              "module": "@jskit-ai/chat-client-element",
              "symbols": [
                "ChatClientElement"
              ]
            }
          },
          "pathOptions": [
            {
              "option": "chat-page-path",
              "defaultValue": "chat",
              "promptLabel": "Chat page path",
              "promptHint": "Relative path under src/pages/app"
            }
          ],
          "contributions": {
            "clientRoutes": [
              {
                "path": "/${option:chat-page-path}",
                "surface": "app",
                "name": "chat",
                "purpose": "Workspace chat page route contribution."
              }
            ],
            "shellEntries": [
              {
                "surface": "app",
                "slot": "drawer",
                "id": "app-chat",
                "title": "Chat",
                "route": "/${option:chat-page-path}",
                "icon": "$chat",
                "order": 35
              }
            ],
            "files": [
              {
                "from": "templates/src/pages/app/chat/index.vue",
                "to": "src/pages/app/${option:chat-page-path}/index.vue",
                "reason": "Materialize workspace chat placeholder page.",
                "category": "ui-page",
                "id": "chat-page"
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
