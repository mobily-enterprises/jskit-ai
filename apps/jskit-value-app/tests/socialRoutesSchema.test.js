import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { registerApiRoutes } from "../server/fastify/registerApiRoutes.js";
import { buildRoutes as buildSocialRoutes } from "../server/modules/social/routes.js";

function buildControllers() {
  return {
    social: {
      async listFeed(_request, reply) {
        reply.code(200).send({
          items: [],
          pagination: {}
        });
      },
      async createPost(_request, reply) {
        reply.code(200).send({
          post: {}
        });
      },
      async getPost(_request, reply) {
        reply.code(200).send({
          post: {}
        });
      },
      async updatePost(_request, reply) {
        reply.code(200).send({
          post: {}
        });
      },
      async deletePost(_request, reply) {
        reply.code(200).send({
          deleted: true
        });
      },
      async createComment(_request, reply) {
        reply.code(200).send({
          comment: {}
        });
      },
      async deleteComment(_request, reply) {
        reply.code(200).send({
          deleted: true
        });
      },
      async requestFollow(_request, reply) {
        reply.code(200).send({
          follow: {}
        });
      },
      async undoFollow(_request, reply) {
        reply.code(200).send({
          follow: {}
        });
      },
      async searchActors(_request, reply) {
        reply.code(200).send({
          items: []
        });
      },
      async getActorProfile(_request, reply) {
        reply.code(200).send({
          actor: {},
          counts: {}
        });
      },
      async listNotifications(_request, reply) {
        reply.code(200).send({
          items: [],
          pagination: {}
        });
      },
      async markNotificationsRead(_request, reply) {
        reply.code(200).send({
          updated: true,
          notificationIds: [1]
        });
      },
      async listModerationRules(_request, reply) {
        reply.code(200).send({
          items: []
        });
      },
      async createModerationRule(_request, reply) {
        reply.code(200).send({
          rule: {}
        });
      },
      async deleteModerationRule(_request, reply) {
        reply.code(200).send({
          deleted: true
        });
      },
      async getWebFinger(_request, reply) {
        reply.code(200).send({
          subject: "acct:alice@example.test",
          links: []
        });
      },
      async getActorDocument(_request, reply) {
        reply.code(200).send({});
      },
      async getFollowersCollection(_request, reply) {
        reply.code(200).send({});
      },
      async getFollowingCollection(_request, reply) {
        reply.code(200).send({});
      },
      async getObjectDocument(_request, reply) {
        reply.code(200).send({});
      },
      async processSharedInbox(_request, reply) {
        reply.code(202).send({
          accepted: true,
          eventId: 1,
          activityId: "activity-1",
          activityType: "Create"
        });
      },
      async processActorInbox(_request, reply) {
        reply.code(202).send({
          accepted: true,
          eventId: 2,
          activityId: "activity-2",
          activityType: "Create"
        });
      }
    }
  };
}

function createMissingHandler() {
  return async (_request, reply) => {
    reply.code(501).send({
      error: "missing"
    });
  };
}

test("social routes enforce workspace/app/admin/public policy metadata", () => {
  const routes = buildSocialRoutes(buildControllers(), {
    missingHandler: createMissingHandler()
  });

  assert.equal(routes.length, 23);

  for (const route of routes) {
    const path = String(route.path || "");
    if (path.startsWith("/api/workspace/social/")) {
      assert.equal(route.auth, "required");
      assert.equal(route.workspacePolicy, "required");
      assert.equal(route.workspaceSurface, "app");
      continue;
    }

    if (path.startsWith("/api/workspace/admin/social/")) {
      assert.equal(route.auth, "required");
      assert.equal(route.workspacePolicy, "required");
      assert.equal(route.workspaceSurface, "admin");
      continue;
    }

    if (path === "/.well-known/webfinger" || path.startsWith("/ap/")) {
      assert.equal(route.auth, "public");
      assert.equal(route.workspacePolicy, "none");
      assert.equal(route.csrfProtection, false);
    }
  }
});

test("social route schemas validate expected payloads and query params", async () => {
  const app = Fastify();
  const controllers = buildControllers();

  registerApiRoutes(app, {
    controllers,
    routes: buildSocialRoutes(controllers, {
      missingHandler: createMissingHandler()
    })
  });

  const invalidFeed = await app.inject({
    method: "GET",
    url: "/api/v1/workspace/social/feed?limit=0"
  });
  assert.equal(invalidFeed.statusCode, 400);

  const validFeed = await app.inject({
    method: "GET",
    url: "/api/v1/workspace/social/feed?limit=20"
  });
  assert.equal(validFeed.statusCode, 200);

  const invalidPost = await app.inject({
    method: "POST",
    url: "/api/v1/workspace/social/posts",
    payload: {}
  });
  assert.equal(invalidPost.statusCode, 400);

  const validPost = await app.inject({
    method: "POST",
    url: "/api/v1/workspace/social/posts",
    payload: {
      contentText: "hello social"
    }
  });
  assert.equal(validPost.statusCode, 200);

  const invalidFollow = await app.inject({
    method: "POST",
    url: "/api/v1/workspace/social/follows",
    payload: {}
  });
  assert.equal(invalidFollow.statusCode, 400);

  const validFollow = await app.inject({
    method: "POST",
    url: "/api/v1/workspace/social/follows",
    payload: {
      handle: "alice@example.test"
    }
  });
  assert.equal(validFollow.statusCode, 200);

  const invalidModerationRule = await app.inject({
    method: "POST",
    url: "/api/v1/workspace/admin/social/moderation/rules",
    payload: {
      ruleScope: "domain",
      domain: "example.test",
      decision: "unknown"
    }
  });
  assert.equal(invalidModerationRule.statusCode, 400);

  const validModerationRule = await app.inject({
    method: "POST",
    url: "/api/v1/workspace/admin/social/moderation/rules",
    payload: {
      ruleScope: "domain",
      domain: "example.test",
      decision: "block"
    }
  });
  assert.equal(validModerationRule.statusCode, 200);

  const invalidWebfinger = await app.inject({
    method: "GET",
    url: "/.well-known/webfinger"
  });
  assert.equal(invalidWebfinger.statusCode, 400);

  const validWebfinger = await app.inject({
    method: "GET",
    url: "/.well-known/webfinger?resource=acct:alice@example.test"
  });
  assert.equal(validWebfinger.statusCode, 200);

  const validInbox = await app.inject({
    method: "POST",
    url: "/ap/inbox",
    payload: {
      id: "activity-1",
      type: "Create",
      actor: "https://example.test/users/alice",
      object: {
        id: "https://example.test/objects/1"
      }
    }
  });
  assert.equal(validInbox.statusCode, 202);

  await app.close();
});
