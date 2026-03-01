export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/chat-fastify-routes",
  "version": "0.1.0",
  "description": "Fastify controller/routes/schema for chat HTTP endpoints.",
  "dependsOn": [
    "@jskit-ai/chat-core",
    "@jskit-ai/http-contracts",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/value-app-config-shared"
  ],
  "capabilities": {
    "provides": [
      "chat.server-routes"
    ],
    "requires": [
      "chat.core",
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
          "method": "GET",
          "path": "/api/chat/attachments/:attachmentId/content",
          "summary": "Get attachment content for one chat attachment"
        },
        {
          "method": "GET",
          "path": "/api/chat/dm/candidates",
          "summary": "List eligible direct-message candidates for authenticated user"
        },
        {
          "method": "POST",
          "path": "/api/chat/dm/ensure",
          "summary": "Ensure a global direct-message thread with a target user"
        },
        {
          "method": "GET",
          "path": "/api/chat/inbox",
          "summary": "List inbox threads for authenticated user"
        },
        {
          "method": "GET",
          "path": "/api/chat/threads/:threadId",
          "summary": "Fetch one chat thread by id"
        },
        {
          "method": "DELETE",
          "path": "/api/chat/threads/:threadId/attachments/:attachmentId",
          "summary": "Delete one staged thread attachment"
        },
        {
          "method": "POST",
          "path": "/api/chat/threads/:threadId/attachments/reserve",
          "summary": "Reserve one staged attachment slot for a thread"
        },
        {
          "method": "POST",
          "path": "/api/chat/threads/:threadId/attachments/upload",
          "summary": "Upload one reserved thread attachment"
        },
        {
          "method": "GET",
          "path": "/api/chat/threads/:threadId/messages",
          "summary": "List messages for one chat thread"
        },
        {
          "method": "POST",
          "path": "/api/chat/threads/:threadId/messages",
          "summary": "Send one message to a chat thread"
        },
        {
          "method": "DELETE",
          "path": "/api/chat/threads/:threadId/reactions",
          "summary": "Remove a reaction for a thread message"
        },
        {
          "method": "POST",
          "path": "/api/chat/threads/:threadId/reactions",
          "summary": "Add a reaction for a thread message"
        },
        {
          "method": "POST",
          "path": "/api/chat/threads/:threadId/read",
          "summary": "Advance authenticated user read cursor for thread"
        },
        {
          "method": "POST",
          "path": "/api/chat/threads/:threadId/typing",
          "summary": "Emit ephemeral typing state for one chat thread"
        },
        {
          "method": "POST",
          "path": "/api/chat/workspace/ensure",
          "summary": "Ensure canonical workspace chat room for authenticated user workspace context"
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
