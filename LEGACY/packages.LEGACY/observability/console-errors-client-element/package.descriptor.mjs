export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/console-errors-client-element",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/observability-core",
    "@jskit-ai/console-errors-client-runtime"
  ],
  "capabilities": {
    "provides": [
      "observability.console-errors-client"
    ],
    "requires": [
      "observability.core"
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
          "id": "console-errors-client",
          "name": "observability.console-errors-client",
          "capability": "observability.console-errors-client",
          "purpose": "Console/browser error list and detail UI surfaces.",
          "surface": "admin",
          "availability": {
            "import": {
              "module": "@jskit-ai/console-errors-client-element",
              "symbols": [
                "ConsoleErrorListClientElement",
                "ConsoleErrorDetailClientElement"
              ]
            }
          },
          "pathOptions": [
            {
              "option": "console-server-errors-page-path",
              "defaultValue": "errors/server",
              "promptLabel": "Console server errors page path",
              "promptHint": "Relative path under src/pages/admin"
            },
            {
              "option": "console-browser-errors-page-path",
              "defaultValue": "errors/browser",
              "promptLabel": "Console browser errors page path",
              "promptHint": "Relative path under src/pages/admin"
            }
          ],
          "contributions": {
            "clientRoutes": [
              {
                "path": "/${option:console-server-errors-page-path}",
                "surface": "admin",
                "name": "console-server-errors",
                "purpose": "Console server errors route contribution."
              },
              {
                "path": "/${option:console-browser-errors-page-path}",
                "surface": "admin",
                "name": "console-browser-errors",
                "purpose": "Console browser errors route contribution."
              }
            ],
            "shellEntries": [
              {
                "surface": "admin",
                "slot": "drawer",
                "id": "admin-server-errors",
                "title": "Server errors",
                "route": "/${option:console-server-errors-page-path}",
                "icon": "$consoleServerErrors",
                "order": 45
              },
              {
                "surface": "admin",
                "slot": "drawer",
                "id": "admin-browser-errors",
                "title": "Browser errors",
                "route": "/${option:console-browser-errors-page-path}",
                "icon": "$consoleBrowserErrors",
                "order": 46
              }
            ],
            "files": [
              {
                "from": "templates/src/pages/admin/server-errors/index.vue",
                "to": "src/pages/admin/${option:console-server-errors-page-path}/index.vue",
                "reason": "Materialize console server errors placeholder page.",
                "category": "ui-page",
                "id": "server-errors-page"
              },
              {
                "from": "templates/src/pages/admin/browser-errors/index.vue",
                "to": "src/pages/admin/${option:console-browser-errors-page-path}/index.vue",
                "reason": "Materialize console browser errors placeholder page.",
                "category": "ui-page",
                "id": "browser-errors-page"
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
        "@jskit-ai/console-errors-client-runtime": "0.1.0",
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
