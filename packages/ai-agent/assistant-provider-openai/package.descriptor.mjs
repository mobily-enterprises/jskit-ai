export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/assistant-provider-openai",
  "version": "0.1.0",
  "options": {
    "ai-api-key": {
      "required": true,
      "values": [],
      "promptLabel": "AI API key",
      "promptHint": "OpenAI API key (sk-...)"
    }
  },
  "dependsOn": [],
  "capabilities": {
    "provides": [
      "assistant.provider.openai",
      "assistant.provider"
    ],
    "requires": []
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "openai": "^6.22.0"
      },
      "dev": {}
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": [],
    "text": [
      {
        "file": ".env",
        "op": "upsert-env",
        "key": "AI_PROVIDER",
        "value": "openai",
        "reason": "Select OpenAI as the assistant provider.",
        "category": "runtime-config",
        "id": "ai-provider"
      },
      {
        "file": ".env",
        "op": "upsert-env",
        "key": "AI_API_KEY",
        "value": "${option:ai-api-key}",
        "reason": "Configure OpenAI API key for assistant requests.",
        "category": "runtime-config",
        "id": "ai-api-key"
      }
    ]
  }
});
