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
      "elements": [
        {
          "name": "users.members-admin.client",
          "capability": "users.members-admin.client",
          "purpose": "UI element contribution.",
          "surface": ""
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
