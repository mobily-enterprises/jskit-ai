export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/social-fastify-routes",
  "version": "0.1.0",
  "description": "Fastify controller/routes/schema wiring for social APIs.",
  "dependsOn": [
    "@jskit-ai/social-core",
    "@jskit-ai/http-contracts",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/value-app-config-shared"
  ],
  "capabilities": {
    "provides": [
      "social.server-routes"
    ],
    "requires": [
      "social.core",
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
          "path": "/.well-known/webfinger",
          "summary": "Resolve actor via webfinger"
        },
        {
          "method": "GET",
          "path": "/ap/actors/:username",
          "summary": "Resolve ActivityPub actor document"
        },
        {
          "method": "GET",
          "path": "/ap/actors/:username/followers",
          "summary": "Resolve ActivityPub followers collection"
        },
        {
          "method": "GET",
          "path": "/ap/actors/:username/following",
          "summary": "Resolve ActivityPub following collection"
        },
        {
          "method": "POST",
          "path": "/ap/actors/:username/inbox",
          "summary": "Process actor-specific ActivityPub inbox"
        },
        {
          "method": "GET",
          "path": "/ap/actors/:username/outbox",
          "summary": "Resolve ActivityPub outbox collection"
        },
        {
          "method": "POST",
          "path": "/ap/inbox",
          "summary": "Process shared ActivityPub inbox"
        },
        {
          "method": "GET",
          "path": "/ap/objects/:objectId",
          "summary": "Resolve ActivityPub object document"
        },
        {
          "method": "GET",
          "path": "/api/workspace/admin/social/moderation/rules",
          "summary": "List moderation rules"
        },
        {
          "method": "POST",
          "path": "/api/workspace/admin/social/moderation/rules",
          "summary": "Create moderation rule"
        },
        {
          "method": "DELETE",
          "path": "/api/workspace/admin/social/moderation/rules/:ruleId",
          "summary": "Delete moderation rule"
        },
        {
          "method": "GET",
          "path": "/api/workspace/social/actors/:actorId",
          "summary": "Get social actor profile"
        },
        {
          "method": "GET",
          "path": "/api/workspace/social/actors/search",
          "summary": "Search social actors"
        },
        {
          "method": "DELETE",
          "path": "/api/workspace/social/comments/:commentId",
          "summary": "Delete social comment"
        },
        {
          "method": "GET",
          "path": "/api/workspace/social/feed",
          "summary": "List workspace social feed"
        },
        {
          "method": "POST",
          "path": "/api/workspace/social/follows",
          "summary": "Request social follow"
        },
        {
          "method": "DELETE",
          "path": "/api/workspace/social/follows/:followId",
          "summary": "Undo social follow"
        },
        {
          "method": "GET",
          "path": "/api/workspace/social/notifications",
          "summary": "List social notifications"
        },
        {
          "method": "POST",
          "path": "/api/workspace/social/notifications/read",
          "summary": "Mark social notifications as read"
        },
        {
          "method": "POST",
          "path": "/api/workspace/social/posts",
          "summary": "Create social post"
        },
        {
          "method": "DELETE",
          "path": "/api/workspace/social/posts/:postId",
          "summary": "Delete social post"
        },
        {
          "method": "GET",
          "path": "/api/workspace/social/posts/:postId",
          "summary": "Get social post"
        },
        {
          "method": "PATCH",
          "path": "/api/workspace/social/posts/:postId",
          "summary": "Update social post"
        },
        {
          "method": "POST",
          "path": "/api/workspace/social/posts/:postId/comments",
          "summary": "Create social comment"
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
