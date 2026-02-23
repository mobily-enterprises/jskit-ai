import { Type } from "@fastify/type-provider-typebox";
import { enumSchema } from "../api/schema.js";

const DEFAULT_MAX_INPUT_CHARS = 8000;
const DEFAULT_MAX_HISTORY_MESSAGES = 20;

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function createSchema({ maxInputChars = DEFAULT_MAX_INPUT_CHARS, maxHistoryMessages = DEFAULT_MAX_HISTORY_MESSAGES } = {}) {
  const inputLimit = toPositiveInteger(maxInputChars, DEFAULT_MAX_INPUT_CHARS);
  const historyLimit = toPositiveInteger(maxHistoryMessages, DEFAULT_MAX_HISTORY_MESSAGES);
  const role = enumSchema(["user", "assistant"]);
  const transcriptMode = enumSchema(["standard", "restricted", "disabled"]);
  const transcriptStatus = enumSchema(["active", "completed", "failed", "aborted"]);
  const transcriptMetadata = Type.Record(Type.String(), Type.Unknown());

  const historyMessage = Type.Object(
    {
      role,
      content: Type.String({ minLength: 1, maxLength: inputLimit })
    },
    {
      additionalProperties: false
    }
  );

  const clientContext = Type.Object(
    {
      locale: Type.Optional(Type.String({ maxLength: 64 })),
      timezone: Type.Optional(Type.String({ maxLength: 64 }))
    },
    {
      additionalProperties: false
    }
  );

  const streamMetaEvent = Type.Object(
    {
      type: Type.Literal("meta"),
      messageId: Type.String({ minLength: 1, maxLength: 128 }),
      conversationId: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" }), Type.Null()])),
      model: Type.String({ minLength: 1, maxLength: 128 }),
      provider: Type.String({ minLength: 1, maxLength: 64 })
    },
    {
      additionalProperties: false
    }
  );

  const streamAssistantDeltaEvent = Type.Object(
    {
      type: Type.Literal("assistant_delta"),
      delta: Type.String()
    },
    {
      additionalProperties: false
    }
  );

  const streamAssistantMessageEvent = Type.Object(
    {
      type: Type.Literal("assistant_message"),
      text: Type.String()
    },
    {
      additionalProperties: false
    }
  );

  const streamToolCallEvent = Type.Object(
    {
      type: Type.Literal("tool_call"),
      toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
      name: Type.String({ minLength: 1, maxLength: 120 }),
      arguments: Type.String()
    },
    {
      additionalProperties: false
    }
  );

  const streamToolResultSuccessEvent = Type.Object(
    {
      type: Type.Literal("tool_result"),
      toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
      name: Type.String({ minLength: 1, maxLength: 120 }),
      ok: Type.Literal(true),
      result: Type.Optional(Type.Unknown())
    },
    {
      additionalProperties: false
    }
  );

  const streamToolResultErrorEvent = Type.Object(
    {
      type: Type.Literal("tool_result"),
      toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
      name: Type.String({ minLength: 1, maxLength: 120 }),
      ok: Type.Literal(false),
      error: Type.Object(
        {
          code: Type.String({ minLength: 1, maxLength: 120 }),
          message: Type.String({ minLength: 1, maxLength: 512 })
        },
        {
          additionalProperties: false
        }
      )
    },
    {
      additionalProperties: false
    }
  );

  const streamErrorEvent = Type.Object(
    {
      type: Type.Literal("error"),
      messageId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
      code: Type.String({ minLength: 1, maxLength: 120 }),
      message: Type.String({ minLength: 1, maxLength: 512 }),
      status: Type.Integer({ minimum: 400, maximum: 599 })
    },
    {
      additionalProperties: false
    }
  );

  const streamDoneEvent = Type.Object(
    {
      type: Type.Literal("done"),
      messageId: Type.String({ minLength: 1, maxLength: 128 })
    },
    {
      additionalProperties: false
    }
  );

  const streamEvent = Type.Union([
    streamMetaEvent,
    streamAssistantDeltaEvent,
    streamAssistantMessageEvent,
    streamToolCallEvent,
    streamToolResultSuccessEvent,
    streamToolResultErrorEvent,
    streamErrorEvent,
    streamDoneEvent
  ]);

  const conversation = Type.Object(
    {
      id: Type.Integer({ minimum: 1 }),
      workspaceId: Type.Integer({ minimum: 1 }),
      workspaceSlug: Type.String(),
      workspaceName: Type.String(),
      title: Type.Optional(Type.String({ maxLength: 160 })),
      createdByUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      createdByUserDisplayName: Type.String({ maxLength: 120 }),
      createdByUserEmail: Type.String({ maxLength: 320 }),
      status: transcriptStatus,
      transcriptMode,
      provider: Type.String({ maxLength: 64 }),
      model: Type.String({ maxLength: 128 }),
      startedAt: Type.String({ minLength: 1 }),
      endedAt: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
      messageCount: Type.Integer({ minimum: 0 }),
      metadata: transcriptMetadata,
      createdAt: Type.String({ minLength: 1 }),
      updatedAt: Type.String({ minLength: 1 })
    },
    {
      additionalProperties: false
    }
  );

  const transcriptMessage = Type.Object(
    {
      id: Type.Integer({ minimum: 1 }),
      conversationId: Type.Integer({ minimum: 1 }),
      workspaceId: Type.Integer({ minimum: 1 }),
      workspaceSlug: Type.String(),
      workspaceName: Type.String(),
      seq: Type.Integer({ minimum: 1 }),
      role: Type.String({ minLength: 1, maxLength: 32 }),
      kind: Type.String({ minLength: 1, maxLength: 32 }),
      clientMessageId: Type.String({ maxLength: 128 }),
      actorUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      contentText: Type.Union([Type.String(), Type.Null()]),
      contentRedacted: Type.Boolean(),
      redactionHits: transcriptMetadata,
      metadata: transcriptMetadata,
      createdAt: Type.String({ minLength: 1 })
    },
    {
      additionalProperties: false
    }
  );

  return {
    body: {
      chatStream: Type.Object(
        {
          messageId: Type.String({ minLength: 1, maxLength: 128 }),
          conversationId: Type.Optional(Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })),
          input: Type.String({ minLength: 1, maxLength: inputLimit }),
          history: Type.Optional(Type.Array(historyMessage, { maxItems: historyLimit })),
          clientContext: Type.Optional(clientContext)
        },
        {
          additionalProperties: false
        }
      )
    },
    query: {
      conversations: Type.Object(
        {
          page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
          pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 20 })),
          from: Type.Optional(Type.String({ maxLength: 64 })),
          to: Type.Optional(Type.String({ maxLength: 64 })),
          status: Type.Optional(transcriptStatus)
        },
        {
          additionalProperties: false
        }
      ),
      conversationMessages: Type.Object(
        {
          page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
          pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 500 }))
        },
        {
          additionalProperties: false
        }
      )
    },
    params: {
      conversation: Type.Object(
        {
          conversationId: Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })
        },
        {
          additionalProperties: false
        }
      )
    },
    response: {
      stream: streamEvent,
      streamEvent,
      conversations: Type.Object(
        {
          entries: Type.Array(conversation),
          page: Type.Integer({ minimum: 1 }),
          pageSize: Type.Integer({ minimum: 1, maximum: 200 }),
          total: Type.Integer({ minimum: 0 }),
          totalPages: Type.Integer({ minimum: 1 })
        },
        {
          additionalProperties: false
        }
      ),
      conversationMessages: Type.Object(
        {
          conversation,
          entries: Type.Array(transcriptMessage),
          page: Type.Integer({ minimum: 1 }),
          pageSize: Type.Integer({ minimum: 1, maximum: 500 }),
          total: Type.Integer({ minimum: 0 }),
          totalPages: Type.Integer({ minimum: 1 })
        },
        {
          additionalProperties: false
        }
      )
    }
  };
}

const schema = createSchema();

export { schema, createSchema };
