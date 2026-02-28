export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/profile-client-element",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/user-profile-core"
  ],
  "capabilities": {
    "provides": [
      "users.profile.client"
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
          "id": "users-profile-client",
          "name": "users.profile.client",
          "capability": "users.profile.client",
          "purpose": "Profile settings UI surface.",
          "surface": "app",
          "availability": {
            "import": {
              "module": "@jskit-ai/profile-client-element",
              "symbols": [
                "ProfileClientElement"
              ]
            }
          },
          "pathOptions": [
            {
              "option": "profile-page-path",
              "defaultValue": "settings/profile",
              "promptLabel": "Profile page path",
              "promptHint": "Relative path under src/pages/app"
            }
          ],
          "contributions": {
            "clientRoutes": [
              {
                "path": "/${option:profile-page-path}",
                "surface": "app",
                "name": "profile",
                "purpose": "Profile settings route contribution."
              }
            ],
            "shellEntries": [
              {
                "surface": "app",
                "slot": "top",
                "id": "app-profile-top",
                "title": "Profile",
                "route": "/${option:profile-page-path}",
                "icon": "$profile",
                "order": 80
              },
              {
                "surface": "app",
                "slot": "config",
                "id": "app-profile-config",
                "title": "Profile",
                "route": "/${option:profile-page-path}",
                "icon": "$profile",
                "order": 35
              }
            ],
            "files": [
              {
                "from": "templates/src/pages/app/profile/index.vue",
                "to": "src/pages/app/${option:profile-page-path}/index.vue",
                "reason": "Materialize profile settings placeholder page.",
                "category": "ui-page",
                "id": "profile-page"
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
