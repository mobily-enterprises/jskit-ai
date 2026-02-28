export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/members-admin-client-element",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/user-profile-core"
  ],
  "capabilities": {
    "provides": [
      "users.members-admin.client"
    ],
    "requires": [
      "users.profile.core"
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
          "id": "members-admin-client",
          "name": "users.members-admin.client",
          "capability": "users.members-admin.client",
          "purpose": "Members administration UI surface.",
          "surface": "admin",
          "availability": {
            "import": {
              "module": "@jskit-ai/members-admin-client-element",
              "symbols": [
                "MembersAdminClientElement"
              ]
            }
          },
          "pathOptions": [
            {
              "option": "members-admin-page-path",
              "defaultValue": "members",
              "promptLabel": "Members admin page path",
              "promptHint": "Relative path under src/pages/admin"
            }
          ],
          "contributions": {
            "clientRoutes": [
              {
                "path": "/${option:members-admin-page-path}",
                "surface": "admin",
                "name": "members-admin",
                "purpose": "Members administration route contribution."
              }
            ],
            "shellEntries": [
              {
                "surface": "admin",
                "slot": "drawer",
                "id": "admin-members",
                "title": "Members",
                "route": "/${option:members-admin-page-path}",
                "icon": "$consoleMembers",
                "order": 42
              }
            ],
            "files": [
              {
                "from": "templates/src/pages/admin/members/index.vue",
                "to": "src/pages/admin/${option:members-admin-page-path}/index.vue",
                "reason": "Materialize members administration placeholder page.",
                "category": "ui-page",
                "id": "members-admin-page"
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
