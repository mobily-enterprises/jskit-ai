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
      "routes": [
        {
          "path": "/chat",
          "surface": "app",
          "name": "chat",
          "purpose": "Workspace chat page route contribution."
        }
      ],
      "elements": [
        {
          "name": "chat.client-element",
          "capability": "chat.client-element",
          "purpose": "Workspace chat client UI element.",
          "surface": "app"
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
    "files": [
      {
        "from": "templates/src/pages/app/chat/index.vue",
        "to": "src/pages/app/chat/index.vue",
        "reason": "Materialize workspace chat page using chat client element.",
        "category": "ui-page",
        "id": "chat-page"
      },
      {
        "from": "templates/src/surfaces/app/drawer/chat.entry.js",
        "to": "src/surfaces/app/drawer/chat.entry.js",
        "reason": "Add chat entry to app drawer surface.",
        "category": "ui-shell",
        "id": "chat-drawer-entry"
      }
    ]
  }
});
