export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/assistant-transcript-explorer-client-element",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/assistant-transcripts-core"
  ],
  "capabilities": {
    "provides": [
      "assistant.transcripts.explorer.client"
    ],
    "requires": [
      "assistant.transcripts.core"
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
          "id": "assistant-transcripts-explorer",
          "name": "assistant.transcripts.explorer.client",
          "capability": "assistant.transcripts.explorer.client",
          "purpose": "Assistant transcript explorer UI surface.",
          "surface": "admin",
          "availability": {
            "import": {
              "module": "@jskit-ai/assistant-transcript-explorer-client-element",
              "symbols": [
                "AssistantTranscriptExplorerClientElement"
              ]
            }
          },
          "pathOptions": [
            {
              "option": "assistant-transcripts-page-path",
              "defaultValue": "ai/transcripts",
              "promptLabel": "Assistant transcripts page path",
              "promptHint": "Relative path under src/pages/admin"
            }
          ],
          "contributions": {
            "clientRoutes": [
              {
                "path": "/${option:assistant-transcripts-page-path}",
                "surface": "admin",
                "name": "assistant-transcripts",
                "purpose": "Assistant transcript explorer route contribution."
              }
            ],
            "shellEntries": [
              {
                "surface": "admin",
                "slot": "drawer",
                "id": "admin-assistant-transcripts",
                "title": "AI transcripts",
                "route": "/${option:assistant-transcripts-page-path}",
                "icon": "$assistantTranscripts",
                "order": 55
              }
            ],
            "files": [
              {
                "from": "templates/src/pages/admin/assistant-transcripts/index.vue",
                "to": "src/pages/admin/${option:assistant-transcripts-page-path}/index.vue",
                "reason": "Materialize assistant transcript explorer placeholder page.",
                "category": "ui-page",
                "id": "assistant-transcripts-page"
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
