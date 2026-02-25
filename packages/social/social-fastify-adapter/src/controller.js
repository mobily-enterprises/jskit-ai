const SOCIAL_ACTION_IDS = Object.freeze({
  FEED_READ: "social.feed.read",
  POST_GET: "social.post.get",
  POST_CREATE: "social.post.create",
  POST_UPDATE: "social.post.update",
  POST_DELETE: "social.post.delete",
  COMMENT_CREATE: "social.comment.create",
  COMMENT_DELETE: "social.comment.delete",
  FOLLOW_REQUEST: "social.follow.request",
  FOLLOW_UNDO: "social.follow.undo",
  ACTOR_SEARCH: "social.actor.search",
  ACTOR_PROFILE_READ: "social.actor.profile.read",
  NOTIFICATIONS_LIST: "social.notifications.list",
  NOTIFICATIONS_MARK_READ: "social.notifications.mark_read",
  MODERATION_RULES_LIST: "social.moderation.rules.list",
  MODERATION_RULE_CREATE: "social.moderation.rule.create",
  MODERATION_RULE_DELETE: "social.moderation.rule.delete",
  FEDERATION_WEBFINGER_GET: "social.federation.webfinger.get",
  FEDERATION_ACTOR_GET: "social.federation.actor.get",
  FEDERATION_FOLLOWERS_GET: "social.federation.followers.get",
  FEDERATION_FOLLOWING_GET: "social.federation.following.get",
  FEDERATION_OBJECT_GET: "social.federation.object.get",
  FEDERATION_INBOX_PROCESS: "social.federation.inbox.process"
});

function executeAction(actionExecutor, { actionId, request, input = {} }) {
  return actionExecutor.execute({
    actionId,
    input,
    context: {
      request,
      channel: "api"
    }
  });
}

function normalizeRequestPathname(request) {
  const rawUrl = String(request?.raw?.url || request?.url || "").trim();
  if (!rawUrl) {
    return "/";
  }

  const pathname = rawUrl.split("?")[0].split("#")[0];
  return pathname || "/";
}

function createController({ actionExecutor }) {
  if (!actionExecutor || typeof actionExecutor.execute !== "function") {
    throw new Error("actionExecutor.execute is required.");
  }

  async function listFeed(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.FEED_READ,
      request,
      input: {
        cursor: request.query?.cursor,
        limit: request.query?.limit
      }
    });

    reply.code(200).send(response);
  }

  async function createPost(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.POST_CREATE,
      request,
      input: request.body || {}
    });

    reply.code(200).send(response);
  }

  async function getPost(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.POST_GET,
      request,
      input: {
        postId: request.params?.postId
      }
    });

    reply.code(200).send(response);
  }

  async function updatePost(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.POST_UPDATE,
      request,
      input: {
        postId: request.params?.postId,
        ...(request.body || {})
      }
    });

    reply.code(200).send(response);
  }

  async function deletePost(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.POST_DELETE,
      request,
      input: {
        postId: request.params?.postId
      }
    });

    reply.code(200).send(response);
  }

  async function createComment(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.COMMENT_CREATE,
      request,
      input: {
        postId: request.params?.postId,
        ...(request.body || {})
      }
    });

    reply.code(200).send(response);
  }

  async function deleteComment(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.COMMENT_DELETE,
      request,
      input: {
        commentId: request.params?.commentId
      }
    });

    reply.code(200).send(response);
  }

  async function requestFollow(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.FOLLOW_REQUEST,
      request,
      input: request.body || {}
    });

    reply.code(200).send(response);
  }

  async function undoFollow(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.FOLLOW_UNDO,
      request,
      input: {
        followId: request.params?.followId
      }
    });

    reply.code(200).send(response);
  }

  async function searchActors(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.ACTOR_SEARCH,
      request,
      input: {
        query: request.query?.q,
        limit: request.query?.limit
      }
    });

    reply.code(200).send(response);
  }

  async function getActorProfile(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.ACTOR_PROFILE_READ,
      request,
      input: {
        actorId: request.params?.actorId
      }
    });

    reply.code(200).send(response);
  }

  async function listNotifications(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.NOTIFICATIONS_LIST,
      request,
      input: {
        cursor: request.query?.cursor,
        limit: request.query?.limit,
        unreadOnly: request.query?.unreadOnly
      }
    });

    reply.code(200).send(response);
  }

  async function markNotificationsRead(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.NOTIFICATIONS_MARK_READ,
      request,
      input: request.body || {}
    });

    reply.code(200).send(response);
  }

  async function listModerationRules(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.MODERATION_RULES_LIST,
      request,
      input: {
        ruleScope: request.query?.ruleScope
      }
    });

    reply.code(200).send(response);
  }

  async function createModerationRule(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.MODERATION_RULE_CREATE,
      request,
      input: request.body || {}
    });

    reply.code(200).send(response);
  }

  async function deleteModerationRule(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.MODERATION_RULE_DELETE,
      request,
      input: {
        ruleId: request.params?.ruleId
      }
    });

    reply.code(200).send(response);
  }

  async function getWebFinger(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.FEDERATION_WEBFINGER_GET,
      request,
      input: {
        resource: request.query?.resource
      }
    });

    reply.type("application/jrd+json; charset=utf-8");
    reply.code(200).send(response);
  }

  async function getActorDocument(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.FEDERATION_ACTOR_GET,
      request,
      input: {
        username: request.params?.username
      }
    });

    reply.type("application/activity+json; charset=utf-8");
    reply.code(200).send(response);
  }

  async function getFollowersCollection(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.FEDERATION_FOLLOWERS_GET,
      request,
      input: {
        username: request.params?.username
      }
    });

    reply.type("application/activity+json; charset=utf-8");
    reply.code(200).send(response);
  }

  async function getFollowingCollection(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.FEDERATION_FOLLOWING_GET,
      request,
      input: {
        username: request.params?.username
      }
    });

    reply.type("application/activity+json; charset=utf-8");
    reply.code(200).send(response);
  }

  async function getObjectDocument(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.FEDERATION_OBJECT_GET,
      request,
      input: {
        objectId: request.params?.objectId
      }
    });

    reply.type("application/activity+json; charset=utf-8");
    reply.code(200).send(response);
  }

  async function processSharedInbox(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.FEDERATION_INBOX_PROCESS,
      request,
      input: {
        targetUsername: "",
        activity: request.body || {},
        requestMeta: {
          signatureHeader: request.headers?.signature,
          digestHeader: request.headers?.digest,
          method: request.method,
          pathname: normalizeRequestPathname(request),
          headers: request.headers || {},
          rawBody: request.rawBody || null
        }
      }
    });

    reply.code(202).send(response);
  }

  async function processActorInbox(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SOCIAL_ACTION_IDS.FEDERATION_INBOX_PROCESS,
      request,
      input: {
        targetUsername: request.params?.username,
        activity: request.body || {},
        requestMeta: {
          signatureHeader: request.headers?.signature,
          digestHeader: request.headers?.digest,
          method: request.method,
          pathname: normalizeRequestPathname(request),
          headers: request.headers || {},
          rawBody: request.rawBody || null
        }
      }
    });

    reply.code(202).send(response);
  }

  return {
    listFeed,
    createPost,
    getPost,
    updatePost,
    deletePost,
    createComment,
    deleteComment,
    requestFollow,
    undoFollow,
    searchActors,
    getActorProfile,
    listNotifications,
    markNotificationsRead,
    listModerationRules,
    createModerationRule,
    deleteModerationRule,
    getWebFinger,
    getActorDocument,
    getFollowersCollection,
    getFollowingCollection,
    getObjectDocument,
    processSharedInbox,
    processActorInbox
  };
}

export { createController, SOCIAL_ACTION_IDS };
