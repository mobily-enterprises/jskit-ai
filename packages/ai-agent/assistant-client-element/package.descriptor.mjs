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
      "elements": [
        {
          "name": "assistant.client-element",
          "capability": "assistant.client-element",
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
