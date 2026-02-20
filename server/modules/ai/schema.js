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
    response: {
      stream: streamEvent,
      streamEvent
    }
  };
}

const schema = createSchema();

export { schema, createSchema };
