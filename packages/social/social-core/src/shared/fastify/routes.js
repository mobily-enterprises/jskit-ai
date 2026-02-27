import { Type } from "@fastify/type-provider-typebox";
import { createSchema } from "./schema.js";

function passthroughErrorResponses(successResponses) {
  return successResponses;
}

function buildRoutes(
  controllers,
  {
    missingHandler,
    withStandardErrorResponses: withStandardErrorResponsesImpl = null,
    postMaxChars = 5000,
    commentMaxChars = 2000,
    feedPageSizeMax = 50,
    notificationsPageSizeMax = 50,
    actorSearchLimitMax = 50,
    inboxMaxPayloadBytes = 1_000_000
  } = {}
) {
  const withErrors =
    typeof withStandardErrorResponsesImpl === "function" ? withStandardErrorResponsesImpl : passthroughErrorResponses;

  const schema = createSchema({
    postMaxChars,
    commentMaxChars,
    feedPageSizeMax,
    notificationsPageSizeMax,
    actorSearchLimitMax,
    inboxMaxPayloadBytes
  });

  return [
    {
      path: "/api/workspace/social/feed",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "social.read",
      schema: {
        tags: ["social"],
        summary: "List workspace social feed",
        querystring: schema.query.feed,
        response: withErrors(
          {
            200: schema.response.feed
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.social?.listFeed || missingHandler
    },
    {
      path: "/api/workspace/social/posts",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "social.write",
      schema: {
        tags: ["social"],
        summary: "Create social post",
        body: schema.body.postCreate,
        response: withErrors(
          {
            200: schema.response.post
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.social?.createPost || missingHandler
    },
    {
      path: "/api/workspace/social/posts/:postId",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "social.read",
      schema: {
        tags: ["social"],
        summary: "Get social post",
        params: schema.params.post,
        response: withErrors({
          200: schema.response.post
        })
      },
      handler: controllers.social?.getPost || missingHandler
    },
    {
      path: "/api/workspace/social/posts/:postId",
      method: "PATCH",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "social.write",
      schema: {
        tags: ["social"],
        summary: "Update social post",
        params: schema.params.post,
        body: schema.body.postUpdate,
        response: withErrors(
          {
            200: schema.response.post
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.social?.updatePost || missingHandler
    },
    {
      path: "/api/workspace/social/posts/:postId",
      method: "DELETE",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "social.write",
      schema: {
        tags: ["social"],
        summary: "Delete social post",
        params: schema.params.post,
        response: withErrors({
          200: schema.response.deleted
        })
      },
      handler: controllers.social?.deletePost || missingHandler
    },
    {
      path: "/api/workspace/social/posts/:postId/comments",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "social.write",
      schema: {
        tags: ["social"],
        summary: "Create social comment",
        params: schema.params.post,
        body: schema.body.commentCreate,
        response: withErrors(
          {
            200: schema.response.comment
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.social?.createComment || missingHandler
    },
    {
      path: "/api/workspace/social/comments/:commentId",
      method: "DELETE",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "social.write",
      schema: {
        tags: ["social"],
        summary: "Delete social comment",
        params: schema.params.comment,
        response: withErrors({
          200: schema.response.deleted
        })
      },
      handler: controllers.social?.deleteComment || missingHandler
    },
    {
      path: "/api/workspace/social/follows",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "social.write",
      schema: {
        tags: ["social"],
        summary: "Request social follow",
        body: schema.body.followCreate,
        response: withErrors(
          {
            200: schema.response.follow
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.social?.requestFollow || missingHandler
    },
    {
      path: "/api/workspace/social/follows/:followId",
      method: "DELETE",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "social.write",
      schema: {
        tags: ["social"],
        summary: "Undo social follow",
        params: schema.params.follow,
        response: withErrors({
          200: schema.response.follow
        })
      },
      handler: controllers.social?.undoFollow || missingHandler
    },
    {
      path: "/api/workspace/social/actors/search",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "social.read",
      schema: {
        tags: ["social"],
        summary: "Search social actors",
        querystring: schema.query.actorSearch,
        response: withErrors(
          {
            200: schema.response.actorSearch
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.social?.searchActors || missingHandler
    },
    {
      path: "/api/workspace/social/actors/:actorId",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "social.read",
      schema: {
        tags: ["social"],
        summary: "Get social actor profile",
        params: schema.params.actor,
        response: withErrors({
          200: schema.response.actorProfile
        })
      },
      handler: controllers.social?.getActorProfile || missingHandler
    },
    {
      path: "/api/workspace/social/notifications",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "social.read",
      schema: {
        tags: ["social"],
        summary: "List social notifications",
        querystring: schema.query.notifications,
        response: withErrors(
          {
            200: schema.response.notifications
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.social?.listNotifications || missingHandler
    },
    {
      path: "/api/workspace/social/notifications/read",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "social.read",
      schema: {
        tags: ["social"],
        summary: "Mark social notifications as read",
        body: schema.body.notificationsRead,
        response: withErrors(
          {
            200: schema.response.notificationsRead
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.social?.markNotificationsRead || missingHandler
    },
    {
      path: "/api/workspace/admin/social/moderation/rules",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "social.moderate",
      schema: {
        tags: ["social"],
        summary: "List moderation rules",
        querystring: schema.query.moderationRules,
        response: withErrors({
          200: schema.response.moderationRules
        })
      },
      handler: controllers.social?.listModerationRules || missingHandler
    },
    {
      path: "/api/workspace/admin/social/moderation/rules",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "social.moderate",
      schema: {
        tags: ["social"],
        summary: "Create moderation rule",
        body: schema.body.moderationRuleCreate,
        response: withErrors(
          {
            200: schema.response.moderationRule
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.social?.createModerationRule || missingHandler
    },
    {
      path: "/api/workspace/admin/social/moderation/rules/:ruleId",
      method: "DELETE",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "social.moderate",
      schema: {
        tags: ["social"],
        summary: "Delete moderation rule",
        params: schema.params.moderationRule,
        response: withErrors({
          200: schema.response.deleted
        })
      },
      handler: controllers.social?.deleteModerationRule || missingHandler
    },
    {
      path: "/.well-known/webfinger",
      method: "GET",
      auth: "public",
      workspacePolicy: "none",
      csrfProtection: false,
      schema: {
        tags: ["social-federation"],
        summary: "Resolve actor via webfinger",
        querystring: schema.query.webFinger,
        response: withErrors(
          {
            200: schema.response.webFinger
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.social?.getWebFinger || missingHandler
    },
    {
      path: "/ap/actors/:username",
      method: "GET",
      auth: "public",
      workspacePolicy: "none",
      csrfProtection: false,
      schema: {
        tags: ["social-federation"],
        summary: "Resolve ActivityPub actor document",
        params: schema.params.actorUsername,
        response: withErrors({
          200: schema.response.activity
        })
      },
      handler: controllers.social?.getActorDocument || missingHandler
    },
    {
      path: "/ap/actors/:username/followers",
      method: "GET",
      auth: "public",
      workspacePolicy: "none",
      csrfProtection: false,
      schema: {
        tags: ["social-federation"],
        summary: "Resolve ActivityPub followers collection",
        params: schema.params.actorUsername,
        response: withErrors({
          200: schema.response.activity
        })
      },
      handler: controllers.social?.getFollowersCollection || missingHandler
    },
    {
      path: "/ap/actors/:username/following",
      method: "GET",
      auth: "public",
      workspacePolicy: "none",
      csrfProtection: false,
      schema: {
        tags: ["social-federation"],
        summary: "Resolve ActivityPub following collection",
        params: schema.params.actorUsername,
        response: withErrors({
          200: schema.response.activity
        })
      },
      handler: controllers.social?.getFollowingCollection || missingHandler
    },
    {
      path: "/ap/actors/:username/outbox",
      method: "GET",
      auth: "public",
      workspacePolicy: "none",
      csrfProtection: false,
      schema: {
        tags: ["social-federation"],
        summary: "Resolve ActivityPub outbox collection",
        params: schema.params.actorUsername,
        response: withErrors({
          200: schema.response.activity
        })
      },
      handler: controllers.social?.getOutboxCollection || missingHandler
    },
    {
      path: "/ap/objects/:objectId",
      method: "GET",
      auth: "public",
      workspacePolicy: "none",
      csrfProtection: false,
      schema: {
        tags: ["social-federation"],
        summary: "Resolve ActivityPub object document",
        params: schema.params.object,
        response: withErrors({
          200: schema.response.activity
        })
      },
      handler: controllers.social?.getObjectDocument || missingHandler
    },
    {
      path: "/ap/inbox",
      method: "POST",
      auth: "public",
      workspacePolicy: "none",
      csrfProtection: false,
      bodyLimit: inboxMaxPayloadBytes,
      schema: {
        tags: ["social-federation"],
        summary: "Process shared ActivityPub inbox",
        body: schema.body.inbox,
        response: withErrors({
          202: schema.response.inboxAccepted
        })
      },
      handler: controllers.social?.processSharedInbox || missingHandler
    },
    {
      path: "/ap/actors/:username/inbox",
      method: "POST",
      auth: "public",
      workspacePolicy: "none",
      csrfProtection: false,
      bodyLimit: inboxMaxPayloadBytes,
      schema: {
        tags: ["social-federation"],
        summary: "Process actor-specific ActivityPub inbox",
        params: schema.params.actorUsername,
        body: schema.body.inbox,
        response: withErrors({
          202: schema.response.inboxAccepted
        })
      },
      handler: controllers.social?.processActorInbox || missingHandler
    }
  ];
}

export { buildRoutes };
