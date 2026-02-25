import { Type } from "@fastify/type-provider-typebox";
import { registerTypeBoxFormats } from "@jskit-ai/http-contracts/typeboxFormats";

function createSchema({
  postMaxChars = 5000,
  commentMaxChars = 2000,
  feedPageSizeMax = 50,
  notificationsPageSizeMax = 50,
  actorSearchLimitMax = 50,
  inboxMaxPayloadBytes = 1_000_000
} = {}) {
  registerTypeBoxFormats();

  const postId = Type.Integer({ minimum: 1 });
  const commentId = Type.Integer({ minimum: 1 });
  const followId = Type.Integer({ minimum: 1 });
  const actorId = Type.Integer({ minimum: 1 });
  const ruleId = Type.Integer({ minimum: 1 });

  const postParams = Type.Object(
    {
      postId
    },
    { additionalProperties: false }
  );

  const commentParams = Type.Object(
    {
      commentId
    },
    { additionalProperties: false }
  );

  const followParams = Type.Object(
    {
      followId
    },
    { additionalProperties: false }
  );

  const actorParams = Type.Object(
    {
      actorId
    },
    { additionalProperties: false }
  );

  const moderationRuleParams = Type.Object(
    {
      ruleId
    },
    { additionalProperties: false }
  );

  const actorUsernameParams = Type.Object(
    {
      username: Type.String({ minLength: 1, maxLength: 64 })
    },
    { additionalProperties: false }
  );

  const objectParams = Type.Object(
    {
      objectId: Type.String({ minLength: 1, maxLength: 768 })
    },
    { additionalProperties: false }
  );

  const feedQuery = Type.Object(
    {
      cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: feedPageSizeMax }))
    },
    { additionalProperties: false }
  );

  const actorSearchQuery = Type.Object(
    {
      q: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: actorSearchLimitMax }))
    },
    { additionalProperties: false }
  );

  const notificationsQuery = Type.Object(
    {
      cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: notificationsPageSizeMax })),
      unreadOnly: Type.Optional(Type.Boolean())
    },
    { additionalProperties: false }
  );

  const moderationRulesQuery = Type.Object(
    {
      ruleScope: Type.Optional(Type.Union([Type.Literal("domain"), Type.Literal("actor")]))
    },
    { additionalProperties: false }
  );

  const webFingerQuery = Type.Object(
    {
      resource: Type.String({ minLength: 1, maxLength: 320 })
    },
    { additionalProperties: false }
  );

  const attachmentInput = Type.Object(
    {
      mediaKind: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
      mimeType: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
      url: Type.String({ minLength: 1, maxLength: 1024 }),
      previewUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
      description: Type.Optional(Type.String({ maxLength: 500 })),
      width: Type.Optional(Type.Integer({ minimum: 1 })),
      height: Type.Optional(Type.Integer({ minimum: 1 })),
      sizeBytes: Type.Optional(Type.Integer({ minimum: 1 }))
    },
    { additionalProperties: false }
  );

  const postCreateBody = Type.Object(
    {
      contentText: Type.String({ minLength: 1, maxLength: postMaxChars }),
      contentHtml: Type.Optional(Type.String({ maxLength: postMaxChars * 4 })),
      visibility: Type.Optional(
        Type.Union([
          Type.Literal("public"),
          Type.Literal("unlisted"),
          Type.Literal("followers"),
          Type.Literal("direct")
        ])
      ),
      language: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
      attachments: Type.Optional(Type.Array(attachmentInput, { maxItems: 20 }))
    },
    { additionalProperties: false }
  );

  const postUpdateBody = Type.Object(
    {
      contentText: Type.Optional(Type.String({ minLength: 1, maxLength: postMaxChars })),
      contentHtml: Type.Optional(Type.String({ maxLength: postMaxChars * 4 })),
      visibility: Type.Optional(
        Type.Union([
          Type.Literal("public"),
          Type.Literal("unlisted"),
          Type.Literal("followers"),
          Type.Literal("direct")
        ])
      ),
      language: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
      attachments: Type.Optional(Type.Array(attachmentInput, { maxItems: 20 }))
    },
    {
      additionalProperties: false,
      minProperties: 1
    }
  );

  const commentCreateBody = Type.Object(
    {
      contentText: Type.String({ minLength: 1, maxLength: commentMaxChars }),
      contentHtml: Type.Optional(Type.String({ maxLength: commentMaxChars * 4 })),
      visibility: Type.Optional(
        Type.Union([
          Type.Literal("public"),
          Type.Literal("unlisted"),
          Type.Literal("followers"),
          Type.Literal("direct")
        ])
      ),
      language: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
      attachments: Type.Optional(Type.Array(attachmentInput, { maxItems: 20 }))
    },
    { additionalProperties: false }
  );

  const followCreateBody = Type.Object(
    {
      actorId: Type.Optional(actorId),
      actorUri: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      handle: Type.Optional(Type.String({ minLength: 3, maxLength: 320 }))
    },
    {
      additionalProperties: false,
      minProperties: 1
    }
  );

  const notificationsReadBody = Type.Object(
    {
      notificationIds: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 200 }))
    },
    { additionalProperties: false }
  );

  const moderationRuleBody = Type.Object(
    {
      ruleScope: Type.Union([Type.Literal("domain"), Type.Literal("actor")]),
      domain: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
      actorUri: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      decision: Type.Union([Type.Literal("block"), Type.Literal("mute"), Type.Literal("allow")]),
      reason: Type.Optional(Type.String({ maxLength: 500 }))
    },
    { additionalProperties: false }
  );

  const inboxBody = Type.Object(
    {},
    {
      additionalProperties: true,
      maxProperties: Math.max(1, Math.floor(inboxMaxPayloadBytes / 2))
    }
  );

  const genericObject = Type.Object({}, { additionalProperties: true });

  const feedResponse = Type.Object(
    {
      items: Type.Array(genericObject),
      pagination: genericObject
    },
    { additionalProperties: false }
  );

  const postResponse = Type.Object(
    {
      post: genericObject
    },
    { additionalProperties: false }
  );

  const commentResponse = Type.Object(
    {
      comment: genericObject
    },
    { additionalProperties: false }
  );

  const followResponse = Type.Object(
    {
      follow: genericObject
    },
    { additionalProperties: false }
  );

  const actorSearchResponse = Type.Object(
    {
      items: Type.Array(genericObject)
    },
    { additionalProperties: false }
  );

  const actorProfileResponse = Type.Object(
    {
      actor: genericObject,
      counts: genericObject
    },
    { additionalProperties: false }
  );

  const notificationsResponse = Type.Object(
    {
      items: Type.Array(genericObject),
      pagination: genericObject
    },
    { additionalProperties: false }
  );

  const notificationsReadResponse = Type.Object(
    {
      updated: Type.Boolean(),
      notificationIds: Type.Array(Type.Integer({ minimum: 1 }))
    },
    { additionalProperties: false }
  );

  const moderationRulesResponse = Type.Object(
    {
      items: Type.Array(genericObject)
    },
    { additionalProperties: false }
  );

  const moderationRuleResponse = Type.Object(
    {
      rule: genericObject
    },
    { additionalProperties: false }
  );

  const acceptedInboxResponse = Type.Object(
    {
      accepted: Type.Boolean(),
      eventId: Type.Integer({ minimum: 1 }),
      activityId: Type.String(),
      activityType: Type.String()
    },
    { additionalProperties: false }
  );

  return {
    params: {
      post: postParams,
      comment: commentParams,
      follow: followParams,
      actor: actorParams,
      moderationRule: moderationRuleParams,
      actorUsername: actorUsernameParams,
      object: objectParams
    },
    query: {
      feed: feedQuery,
      actorSearch: actorSearchQuery,
      notifications: notificationsQuery,
      moderationRules: moderationRulesQuery,
      webFinger: webFingerQuery
    },
    body: {
      postCreate: postCreateBody,
      postUpdate: postUpdateBody,
      commentCreate: commentCreateBody,
      followCreate: followCreateBody,
      notificationsRead: notificationsReadBody,
      moderationRuleCreate: moderationRuleBody,
      inbox: inboxBody
    },
    response: {
      feed: feedResponse,
      post: postResponse,
      comment: commentResponse,
      follow: followResponse,
      actorSearch: actorSearchResponse,
      actorProfile: actorProfileResponse,
      notifications: notificationsResponse,
      notificationsRead: notificationsReadResponse,
      moderationRules: moderationRulesResponse,
      moderationRule: moderationRuleResponse,
      webFinger: genericObject,
      activity: genericObject,
      inboxAccepted: acceptedInboxResponse,
      deleted: Type.Object(
        {
          deleted: Type.Boolean()
        },
        { additionalProperties: true }
      )
    }
  };
}

export { createSchema };
