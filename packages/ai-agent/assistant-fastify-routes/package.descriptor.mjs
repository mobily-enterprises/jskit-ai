export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/assistant-fastify-routes",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/assistant-core",
    "@jskit-ai/assistant-contracts",
    "@jskit-ai/http-contracts",
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "assistant.server-routes"
    ],
    "requires": [
      "assistant.core",
      "contracts.assistant",
      "contracts.http",
      "runtime.server"
    ]
  },
  "runtime": {
    "server": {
      "entrypoint": "src/shared/server.js",
      "export": "createServerContributions"
    }
  },
  "metadata": {
    "server": {
      "routes": [
        {
          "method": "POST",
          "path": "/api/workspace/ai/chat/stream",
          "summary": "Stream AI assistant chat response for active workspace"
        },
        {
          "method": "GET",
          "path": "/api/workspace/ai/conversations",
          "summary": "List assistant conversations for current user in active workspace"
        },
        {
          "method": "GET",
          "path": "/api/workspace/ai/conversations/:conversationId/messages",
          "summary": "List messages for one assistant conversation owned by current user"
        }
      ]
    },
    "ui": {
      "elements": []
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@fastify/type-provider-typebox": "^6.1.0",
        "@jskit-ai/http-contracts": "0.1.0"
      },
      "dev": {}
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": []
  }
});
