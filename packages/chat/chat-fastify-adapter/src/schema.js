import { Type } from "@fastify/type-provider-typebox";

function createSchema({
  messageMaxChars = 4000,
  messagePageSizeMax = 100,
  inboxPageSizeMax = 50,
  attachmentsMaxFilesPerMessage = 5,
  attachmentMaxUploadBytes = 20_000_000
} = {}) {
  const threadId = Type.Integer({ minimum: 1 });
  const messageId = Type.Integer({ minimum: 1 });
  const attachmentId = Type.Integer({ minimum: 1 });

  const threadParams = Type.Object(
    {
      threadId
    },
    {
      additionalProperties: false
    }
  );

  const threadAttachmentParams = Type.Object(
    {
      threadId,
      attachmentId
    },
    {
      additionalProperties: false
    }
  );

  const attachmentParams = Type.Object(
    {
      attachmentId
    },
    {
      additionalProperties: false
    }
  );

  const inboxQuery = Type.Object(
    {
      cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: inboxPageSizeMax }))
    },
    {
      additionalProperties: false
    }
  );

  const messagesQuery = Type.Object(
    {
      cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: messagePageSizeMax }))
    },
    {
      additionalProperties: false
    }
  );

  const dmCandidatesQuery = Type.Object(
    {
      q: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
    },
    {
      additionalProperties: false
    }
  );

  const dmEnsureBody = Type.Object(
    {
      targetPublicChatId: Type.String({ minLength: 1, maxLength: 64 })
    },
    {
      additionalProperties: false
    }
  );

  const workspaceEnsureBody = Type.Object({}, { additionalProperties: false });

  const sendMessageBody = Type.Object(
    {
      clientMessageId: Type.String({ minLength: 1, maxLength: 128 }),
      text: Type.Optional(Type.String({ maxLength: messageMaxChars })),
      attachmentIds: Type.Optional(
        Type.Array(attachmentId, { maxItems: Math.max(1, Number(attachmentsMaxFilesPerMessage) || 5) })
      ),
      replyToMessageId: Type.Optional(messageId),
      metadata: Type.Optional(Type.Object({}, { additionalProperties: true }))
    },
    {
      additionalProperties: false
    }
  );

  const reserveAttachmentBody = Type.Object(
    {
      clientAttachmentId: Type.String({ minLength: 1, maxLength: 128 }),
      fileName: Type.String({ minLength: 1, maxLength: 255 }),
      mimeType: Type.String({ minLength: 1, maxLength: 160 }),
      sizeBytes: Type.Integer({ minimum: 1, maximum: Math.max(1, Number(attachmentMaxUploadBytes) || 20_000_000) }),
      kind: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
      metadata: Type.Optional(Type.Object({}, { additionalProperties: true }))
    },
    {
      additionalProperties: false
    }
  );

  const markReadBody = Type.Object(
    {
      messageId: Type.Optional(messageId),
      threadSeq: Type.Optional(Type.Integer({ minimum: 1 }))
    },
    {
      additionalProperties: false,
      minProperties: 1
    }
  );

  const reactionBody = Type.Object(
    {
      messageId,
      reaction: Type.String({ minLength: 1, maxLength: 32 })
    },
    {
      additionalProperties: false
    }
  );

  const reactionSummary = Type.Object(
    {
      reaction: Type.String({ minLength: 1 }),
      count: Type.Integer({ minimum: 0 }),
      reactedByMe: Type.Boolean()
    },
    {
      additionalProperties: false
    }
  );

  const threadParticipant = Type.Object(
    {
      status: Type.String(),
      lastReadSeq: Type.Integer({ minimum: 0 }),
      lastReadMessageId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      lastReadAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
      mutedUntil: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
      archivedAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
      pinnedAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()])
    },
    {
      additionalProperties: false
    }
  );

  const threadUserSummary = Type.Object(
    {
      id: Type.Integer({ minimum: 1 }),
      displayName: Type.String(),
      avatarUrl: Type.Union([Type.String(), Type.Null()])
    },
    {
      additionalProperties: false
    }
  );

  const threadEntity = Type.Object(
    {
      id: Type.Integer({ minimum: 1 }),
      scopeKind: Type.String(),
      workspaceId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      threadKind: Type.String(),
      title: Type.Union([Type.String(), Type.Null()]),
      participantCount: Type.Integer({ minimum: 0 }),
      lastMessageId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      lastMessageSeq: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      lastMessageAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
      lastMessagePreview: Type.Union([Type.String(), Type.Null()]),
      createdAt: Type.String({ format: "iso-utc-date-time" }),
      updatedAt: Type.String({ format: "iso-utc-date-time" }),
      unreadCount: Type.Integer({ minimum: 0 }),
      participant: Type.Union([threadParticipant, Type.Null()]),
      peerUser: Type.Union([threadUserSummary, Type.Null()])
    },
    {
      additionalProperties: false
    }
  );

  const attachmentEntity = Type.Object(
    {
      id: Type.Integer({ minimum: 1 }),
      threadId: Type.Integer({ minimum: 1 }),
      messageId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      uploadedByUserId: Type.Integer({ minimum: 1 }),
      clientAttachmentId: Type.Union([Type.String(), Type.Null()]),
      position: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      kind: Type.String(),
      status: Type.String(),
      mimeType: Type.Union([Type.String(), Type.Null()]),
      fileName: Type.Union([Type.String(), Type.Null()]),
      sizeBytes: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      width: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      height: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      durationMs: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      deliveryPath: Type.Union([Type.String(), Type.Null()]),
      previewDeliveryPath: Type.Union([Type.String(), Type.Null()]),
      createdAt: Type.String({ format: "iso-utc-date-time" }),
      updatedAt: Type.String({ format: "iso-utc-date-time" })
    },
    {
      additionalProperties: false
    }
  );

  const messageEntity = Type.Object(
    {
      id: Type.Integer({ minimum: 1 }),
      threadId: Type.Integer({ minimum: 1 }),
      threadSeq: Type.Integer({ minimum: 1 }),
      senderUserId: Type.Integer({ minimum: 1 }),
      clientMessageId: Type.Union([Type.String(), Type.Null()]),
      kind: Type.String(),
      text: Type.Union([Type.String(), Type.Null()]),
      replyToMessageId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      attachments: Type.Array(attachmentEntity),
      reactions: Type.Array(reactionSummary),
      sentAt: Type.String({ format: "iso-utc-date-time" }),
      editedAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
      deletedAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
      metadata: Type.Object({}, { additionalProperties: true })
    },
    {
      additionalProperties: false
    }
  );

  const inboxResponse = Type.Object(
    {
      items: Type.Array(threadEntity),
      nextCursor: Type.Union([Type.String(), Type.Null()])
    },
    {
      additionalProperties: false
    }
  );

  const threadResponse = Type.Object(
    {
      thread: threadEntity
    },
    {
      additionalProperties: false
    }
  );

  const dmEnsureResponse = Type.Object(
    {
      thread: threadEntity,
      created: Type.Boolean()
    },
    {
      additionalProperties: false
    }
  );

  const workspaceEnsureResponse = Type.Object(
    {
      thread: threadEntity,
      created: Type.Boolean()
    },
    {
      additionalProperties: false
    }
  );

  const dmCandidate = Type.Object(
    {
      userId: Type.Integer({ minimum: 1 }),
      displayName: Type.String(),
      avatarUrl: Type.Union([Type.String(), Type.Null()]),
      publicChatId: Type.String({ minLength: 1, maxLength: 64 }),
      sharedWorkspaceCount: Type.Integer({ minimum: 1 })
    },
    {
      additionalProperties: false
    }
  );

  const dmCandidatesResponse = Type.Object(
    {
      items: Type.Array(dmCandidate)
    },
    {
      additionalProperties: false
    }
  );

  const messagesResponse = Type.Object(
    {
      items: Type.Array(messageEntity),
      nextCursor: Type.Union([Type.String(), Type.Null()])
    },
    {
      additionalProperties: false
    }
  );

  const sendMessageResponse = Type.Object(
    {
      message: messageEntity,
      thread: threadEntity,
      idempotencyStatus: Type.Union([Type.Literal("created"), Type.Literal("replayed")])
    },
    {
      additionalProperties: false
    }
  );

  const attachmentResponse = Type.Object(
    {
      attachment: attachmentEntity
    },
    {
      additionalProperties: false
    }
  );

  const markReadResponse = Type.Object(
    {
      threadId: Type.Integer({ minimum: 1 }),
      lastReadSeq: Type.Integer({ minimum: 0 }),
      lastReadMessageId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])
    },
    {
      additionalProperties: false
    }
  );

  const reactionsResponse = Type.Object(
    {
      messageId: Type.Integer({ minimum: 1 }),
      reactions: Type.Array(reactionSummary)
    },
    {
      additionalProperties: false
    }
  );

  const typingResponse = Type.Object(
    {
      accepted: Type.Literal(true),
      expiresAt: Type.String({ format: "iso-utc-date-time" })
    },
    {
      additionalProperties: false
    }
  );

  return {
    query: {
      inbox: inboxQuery,
      messages: messagesQuery,
      dmCandidates: dmCandidatesQuery
    },
    params: {
      thread: threadParams,
      threadAttachment: threadAttachmentParams,
      attachment: attachmentParams
    },
    body: {
      dmEnsure: dmEnsureBody,
      workspaceEnsure: workspaceEnsureBody,
      sendMessage: sendMessageBody,
      markRead: markReadBody,
      reaction: reactionBody,
      reserveAttachment: reserveAttachmentBody
    },
    response: {
      dmEnsure: dmEnsureResponse,
      workspaceEnsure: workspaceEnsureResponse,
      dmCandidates: dmCandidatesResponse,
      inbox: inboxResponse,
      thread: threadResponse,
      messages: messagesResponse,
      sendMessage: sendMessageResponse,
      attachment: attachmentResponse,
      markRead: markReadResponse,
      reactions: reactionsResponse,
      typing: typingResponse
    }
  };
}

export { createSchema };
