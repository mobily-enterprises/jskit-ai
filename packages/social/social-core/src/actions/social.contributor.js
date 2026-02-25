function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function requireServiceMethod(service, methodName, contributorId) {
  if (!service || typeof service[methodName] !== "function") {
    throw new Error(`${contributorId} requires ${methodName}().`);
  }
}

function resolveRequest(context) {
  return context?.requestMeta?.request || null;
}

function requireAuthenticated(context) {
  return Number(context?.actor?.id) > 0;
}

function requireWorkspaceContext(context) {
  return Number(context?.workspace?.id) > 0;
}

function hasAll(predicates, context) {
  return predicates.every((predicate) => predicate(context));
}

const OBJECT_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

function createSocialActionContributor({ socialService } = {}) {
  const contributorId = "social.core";

  requireServiceMethod(socialService, "listFeed", contributorId);
  requireServiceMethod(socialService, "getPost", contributorId);
  requireServiceMethod(socialService, "createPost", contributorId);
  requireServiceMethod(socialService, "updatePost", contributorId);
  requireServiceMethod(socialService, "deletePost", contributorId);
  requireServiceMethod(socialService, "createComment", contributorId);
  requireServiceMethod(socialService, "deleteComment", contributorId);
  requireServiceMethod(socialService, "requestFollow", contributorId);
  requireServiceMethod(socialService, "acceptFollow", contributorId);
  requireServiceMethod(socialService, "rejectFollow", contributorId);
  requireServiceMethod(socialService, "undoFollow", contributorId);
  requireServiceMethod(socialService, "searchActors", contributorId);
  requireServiceMethod(socialService, "getActorProfile", contributorId);
  requireServiceMethod(socialService, "listNotifications", contributorId);
  requireServiceMethod(socialService, "markNotificationsRead", contributorId);
  requireServiceMethod(socialService, "listModerationRules", contributorId);
  requireServiceMethod(socialService, "createModerationRule", contributorId);
  requireServiceMethod(socialService, "deleteModerationRule", contributorId);
  requireServiceMethod(socialService, "processInboxActivity", contributorId);
  requireServiceMethod(socialService, "deliverOutboxBatch", contributorId);
  requireServiceMethod(socialService, "getWebFinger", contributorId);
  requireServiceMethod(socialService, "getActorDocument", contributorId);
  requireServiceMethod(socialService, "getFollowersCollection", contributorId);
  requireServiceMethod(socialService, "getFollowingCollection", contributorId);
  requireServiceMethod(socialService, "getObjectDocument", contributorId);

  return {
    contributorId,
    domain: "social",
    actions: Object.freeze([
      {
        id: "social.feed.read",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["app", "admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: (context) => hasAll([requireAuthenticated, requireWorkspaceContext], context),
        idempotency: "none",
        audit: {
          actionName: "social.feed.read"
        },
        observability: {},
        async execute(input, context) {
          return socialService.listFeed({
            workspace: context.workspace,
            actor: {
              ...context.actor,
              request: resolveRequest(context)
            }
          });
        }
      },
      {
        id: "social.post.get",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["app", "admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: (context) => hasAll([requireAuthenticated, requireWorkspaceContext], context),
        idempotency: "none",
        audit: {
          actionName: "social.post.get"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.getPost({
            workspace: context.workspace,
            actor: context.actor,
            postId: payload.postId
          });
        }
      },
      {
        id: "social.post.create",
        version: 1,
        kind: "command",
        channels: ["api", "internal", "assistant_tool"],
        surfaces: ["app", "admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: (context) => hasAll([requireAuthenticated, requireWorkspaceContext], context),
        idempotency: "optional",
        audit: {
          actionName: "social.post.create"
        },
        observability: {},
        assistantTool: {
          description: "Create a social post in the current workspace.",
          inputJsonSchema: {
            type: "object",
            required: ["contentText"],
            properties: {
              contentText: {
                type: "string",
                minLength: 1,
                maxLength: 5000
              },
              visibility: {
                type: "string",
                enum: ["public", "unlisted", "followers", "direct"]
              }
            }
          }
        },
        async execute(input, context) {
          return socialService.createPost({
            workspace: context.workspace,
            actor: context.actor,
            payload: normalizeObject(input)
          });
        }
      },
      {
        id: "social.post.update",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: (context) => hasAll([requireAuthenticated, requireWorkspaceContext], context),
        idempotency: "optional",
        audit: {
          actionName: "social.post.update"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.updatePost({
            workspace: context.workspace,
            actor: context.actor,
            postId: payload.postId,
            payload
          });
        }
      },
      {
        id: "social.post.delete",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: (context) => hasAll([requireAuthenticated, requireWorkspaceContext], context),
        idempotency: "optional",
        audit: {
          actionName: "social.post.delete"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.deletePost({
            workspace: context.workspace,
            actor: context.actor,
            postId: payload.postId
          });
        }
      },
      {
        id: "social.comment.create",
        version: 1,
        kind: "command",
        channels: ["api", "internal", "assistant_tool"],
        surfaces: ["app", "admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: (context) => hasAll([requireAuthenticated, requireWorkspaceContext], context),
        idempotency: "optional",
        audit: {
          actionName: "social.comment.create"
        },
        observability: {},
        assistantTool: {
          description: "Create a comment reply for an existing post.",
          inputJsonSchema: {
            type: "object",
            required: ["postId", "contentText"],
            properties: {
              postId: {
                anyOf: [{ type: "integer", minimum: 1 }, { type: "string", minLength: 1 }]
              },
              contentText: {
                type: "string",
                minLength: 1,
                maxLength: 2000
              }
            }
          }
        },
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.createComment({
            workspace: context.workspace,
            actor: context.actor,
            postId: payload.postId,
            payload
          });
        }
      },
      {
        id: "social.comment.delete",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: (context) => hasAll([requireAuthenticated, requireWorkspaceContext], context),
        idempotency: "optional",
        audit: {
          actionName: "social.comment.delete"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.deleteComment({
            workspace: context.workspace,
            actor: context.actor,
            commentId: payload.commentId
          });
        }
      },
      {
        id: "social.follow.request",
        version: 1,
        kind: "command",
        channels: ["api", "internal", "assistant_tool"],
        surfaces: ["app", "admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: (context) => hasAll([requireAuthenticated, requireWorkspaceContext], context),
        idempotency: "optional",
        audit: {
          actionName: "social.follow.request"
        },
        observability: {},
        assistantTool: {
          description: "Follow a social profile by actor URI or handle.",
          inputJsonSchema: {
            type: "object",
            properties: {
              actorId: {
                anyOf: [{ type: "integer", minimum: 1 }, { type: "string", minLength: 1 }]
              },
              actorUri: {
                type: "string",
                minLength: 1
              },
              handle: {
                type: "string",
                minLength: 3
              }
            }
          }
        },
        async execute(input, context) {
          return socialService.requestFollow({
            workspace: context.workspace,
            actor: context.actor,
            payload: normalizeObject(input)
          });
        }
      },
      {
        id: "social.follow.accept",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: (context) => hasAll([requireAuthenticated, requireWorkspaceContext], context),
        idempotency: "optional",
        audit: {
          actionName: "social.follow.accept"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.acceptFollow({
            workspace: context.workspace,
            actor: context.actor,
            followId: payload.followId
          });
        }
      },
      {
        id: "social.follow.reject",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: (context) => hasAll([requireAuthenticated, requireWorkspaceContext], context),
        idempotency: "optional",
        audit: {
          actionName: "social.follow.reject"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.rejectFollow({
            workspace: context.workspace,
            actor: context.actor,
            followId: payload.followId
          });
        }
      },
      {
        id: "social.follow.undo",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: (context) => hasAll([requireAuthenticated, requireWorkspaceContext], context),
        idempotency: "optional",
        audit: {
          actionName: "social.follow.undo"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.undoFollow({
            workspace: context.workspace,
            actor: context.actor,
            followId: payload.followId
          });
        }
      },
      {
        id: "social.actor.search",
        version: 1,
        kind: "query",
        channels: ["api", "internal", "assistant_tool"],
        surfaces: ["app", "admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: (context) => hasAll([requireAuthenticated, requireWorkspaceContext], context),
        idempotency: "none",
        audit: {
          actionName: "social.actor.search"
        },
        observability: {},
        assistantTool: {
          description: "Search social profiles by name, handle, or URI.",
          inputJsonSchema: {
            type: "object",
            properties: {
              query: {
                type: "string"
              },
              limit: {
                type: "integer",
                minimum: 1,
                maximum: 100
              }
            }
          }
        },
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.searchActors({
            workspace: context.workspace,
            actor: context.actor,
            query: payload.query,
            limit: payload.limit
          });
        }
      },
      {
        id: "social.actor.profile.read",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["app", "admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: (context) => hasAll([requireAuthenticated, requireWorkspaceContext], context),
        idempotency: "none",
        audit: {
          actionName: "social.actor.profile.read"
        },
        observability: {},
        async execute(input, context) {
          return socialService.getActorProfile({
            workspace: context.workspace,
            actor: context.actor,
            actorSelector: normalizeObject(input)
          });
        }
      },
      {
        id: "social.notifications.list",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["app", "admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: (context) => hasAll([requireAuthenticated, requireWorkspaceContext], context),
        idempotency: "none",
        audit: {
          actionName: "social.notifications.list"
        },
        observability: {},
        async execute(input, context) {
          return socialService.listNotifications({
            workspace: context.workspace,
            actor: context.actor,
            query: normalizeObject(input)
          });
        }
      },
      {
        id: "social.notifications.mark_read",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["app", "admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: (context) => hasAll([requireAuthenticated, requireWorkspaceContext], context),
        idempotency: "optional",
        audit: {
          actionName: "social.notifications.mark_read"
        },
        observability: {},
        async execute(input, context) {
          return socialService.markNotificationsRead({
            workspace: context.workspace,
            actor: context.actor,
            payload: normalizeObject(input)
          });
        }
      },
      {
        id: "social.moderation.rules.list",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["admin"],
        visibility: "operator",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["social.moderate"],
        idempotency: "none",
        audit: {
          actionName: "social.moderation.rules.list"
        },
        observability: {},
        async execute(input, context) {
          return socialService.listModerationRules({
            workspace: context.workspace,
            actor: context.actor,
            query: normalizeObject(input)
          });
        }
      },
      {
        id: "social.moderation.rule.create",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["admin"],
        visibility: "operator",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["social.moderate"],
        idempotency: "optional",
        audit: {
          actionName: "social.moderation.rule.create"
        },
        observability: {},
        async execute(input, context) {
          return socialService.createModerationRule({
            workspace: context.workspace,
            actor: context.actor,
            payload: normalizeObject(input)
          });
        }
      },
      {
        id: "social.moderation.rule.delete",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["admin"],
        visibility: "operator",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["social.moderate"],
        idempotency: "optional",
        audit: {
          actionName: "social.moderation.rule.delete"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.deleteModerationRule({
            workspace: context.workspace,
            actor: context.actor,
            ruleId: payload.ruleId
          });
        }
      },
      {
        id: "social.federation.webfinger.get",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: () => true,
        idempotency: "none",
        audit: {
          actionName: "social.federation.webfinger.get"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.getWebFinger({
            workspace: context.workspace,
            resource: payload.resource
          });
        }
      },
      {
        id: "social.federation.actor.get",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: () => true,
        idempotency: "none",
        audit: {
          actionName: "social.federation.actor.get"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.getActorDocument({
            workspace: context.workspace,
            username: payload.username
          });
        }
      },
      {
        id: "social.federation.followers.get",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: () => true,
        idempotency: "none",
        audit: {
          actionName: "social.federation.followers.get"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.getFollowersCollection({
            workspace: context.workspace,
            username: payload.username
          });
        }
      },
      {
        id: "social.federation.following.get",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: () => true,
        idempotency: "none",
        audit: {
          actionName: "social.federation.following.get"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.getFollowingCollection({
            workspace: context.workspace,
            username: payload.username
          });
        }
      },
      {
        id: "social.federation.object.get",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["app", "admin", "console"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: () => true,
        idempotency: "none",
        audit: {
          actionName: "social.federation.object.get"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.getObjectDocument({
            workspace: context.workspace,
            objectId: payload.objectId
          });
        }
      },
      {
        id: "social.federation.inbox.process",
        version: 1,
        kind: "command",
        channels: ["api", "internal", "worker"],
        surfaces: ["app", "admin", "console"],
        visibility: "internal",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: () => true,
        idempotency: "domain_native",
        audit: {
          actionName: "social.federation.inbox.process"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.processInboxActivity({
            workspace: context.workspace,
            targetUsername: normalizeText(payload.targetUsername),
            payload: payload.activity,
            requestMeta: payload.requestMeta || {}
          });
        }
      },
      {
        id: "social.federation.outbox.deliveries.process",
        version: 1,
        kind: "command",
        channels: ["internal", "worker"],
        surfaces: ["admin", "console", "app"],
        visibility: "internal",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: () => true,
        idempotency: "domain_native",
        audit: {
          actionName: "social.federation.outbox.deliveries.process"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          return socialService.deliverOutboxBatch({
            workspaceId: payload.workspaceId || context?.workspace?.id,
            limit: payload.limit
          });
        }
      }
    ])
  };
}

export { createSocialActionContributor };
