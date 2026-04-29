import { createSchema } from "json-rest-schema";
import {
  createCursorListValidator,
  RECORD_ID_PATTERN
} from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const MAX_INPUT_CHARS = 8000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_PAGE_SIZE = 200;
const MAX_MESSAGE_PAGE_SIZE = 500;

const historyMessageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["role", "content"],
  properties: {
    role: {
      type: "string",
      enum: ["user", "assistant"]
    },
    content: {
      type: "string",
      minLength: 1,
      maxLength: MAX_INPUT_CHARS
    }
  }
};

const clientContextSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    locale: {
      type: "string",
      maxLength: 64
    },
    timezone: {
      type: "string",
      maxLength: 64
    }
  }
};

const chatStreamBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["messageId", "input"],
  properties: {
    messageId: {
      type: "string",
      minLength: 1,
      maxLength: 128
    },
    conversationId: {
      type: "string",
      minLength: 1,
      pattern: RECORD_ID_PATTERN
    },
    input: {
      type: "string",
      minLength: 1,
      maxLength: MAX_INPUT_CHARS
    },
    history: {
      type: "array",
      maxItems: MAX_HISTORY_MESSAGES,
      items: historyMessageSchema
    },
    clientContext: clientContextSchema
  }
};

const conversationsListQuerySchema = createSchema({
  cursor: {
    type: "id",
    required: false
  },
  limit: {
    type: "number",
    required: false,
    min: 1,
    max: MAX_PAGE_SIZE
  },
  status: {
    type: "string",
    required: false,
    minLength: 1,
    maxLength: 32
  }
});

const conversationRecordSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "workspaceId",
    "title",
    "createdByUserId",
    "status",
    "provider",
    "model",
    "surfaceId",
    "startedAt",
    "endedAt",
    "messageCount",
    "metadata",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: {
      type: "string",
      minLength: 1,
      pattern: RECORD_ID_PATTERN
    },
    workspaceId: {
      anyOf: [
        { type: "string", minLength: 1, pattern: RECORD_ID_PATTERN },
        { type: "null" }
      ]
    },
    title: {
      type: "string"
    },
    createdByUserId: {
      anyOf: [
        { type: "string", minLength: 1, pattern: RECORD_ID_PATTERN },
        { type: "null" }
      ]
    },
    status: {
      type: "string"
    },
    provider: {
      type: "string"
    },
    model: {
      type: "string"
    },
    surfaceId: {
      type: "string"
    },
    startedAt: {
      type: "string",
      minLength: 1
    },
    endedAt: {
      anyOf: [
        { type: "string", minLength: 1 },
        { type: "null" }
      ]
    },
    messageCount: {
      type: "integer",
      minimum: 0
    },
    metadata: {
      type: "object",
      additionalProperties: true
    },
    createdAt: {
      type: "string",
      minLength: 1
    },
    updatedAt: {
      type: "string",
      minLength: 1
    }
  }
};

const conversationRecordOutputDefinition = deepFreeze({
  schema: conversationRecordSchema
});

const messageRecordSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "conversationId",
    "workspaceId",
    "seq",
    "role",
    "kind",
    "clientMessageSid",
    "actorUserId",
    "contentText",
    "metadata",
    "createdAt"
  ],
  properties: {
    id: {
      type: "string",
      minLength: 1,
      pattern: RECORD_ID_PATTERN
    },
    conversationId: {
      type: "string",
      minLength: 1,
      pattern: RECORD_ID_PATTERN
    },
    workspaceId: {
      anyOf: [
        { type: "string", minLength: 1, pattern: RECORD_ID_PATTERN },
        { type: "null" }
      ]
    },
    seq: {
      type: "integer",
      minimum: 1
    },
    role: {
      type: "string",
      minLength: 1
    },
    kind: {
      type: "string",
      minLength: 1
    },
    clientMessageSid: {
      type: "string"
    },
    actorUserId: {
      anyOf: [
        { type: "string", minLength: 1, pattern: RECORD_ID_PATTERN },
        { type: "null" }
      ]
    },
    contentText: {
      anyOf: [
        { type: "string" },
        { type: "null" }
      ]
    },
    metadata: {
      type: "object",
      additionalProperties: true
    },
    createdAt: {
      type: "string",
      minLength: 1
    }
  }
};

const conversationMessagesParamsSchema = createSchema({
  conversationId: {
    type: "id",
    required: true
  }
});

const conversationMessagesQuerySchema = createSchema({
  page: {
    type: "number",
    required: false,
    min: 1
  },
  pageSize: {
    type: "number",
    required: false,
    min: 1,
    max: MAX_MESSAGE_PAGE_SIZE
  }
});

const conversationMessagesOutputDefinition = deepFreeze({
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["page", "pageSize", "total", "totalPages", "conversation", "entries"],
    properties: {
      page: {
        type: "integer",
        minimum: 1
      },
      pageSize: {
        type: "integer",
        minimum: 1
      },
      total: {
        type: "integer",
        minimum: 0
      },
      totalPages: {
        type: "integer",
        minimum: 1
      },
      conversation: conversationRecordSchema,
      entries: {
        type: "array",
        items: messageRecordSchema
      }
    }
  }
});

const assistantResource = deepFreeze({
  namespace: "assistant",
  operations: {
    chatStream: {
      method: "POST",
      body: {
        schema: chatStreamBodySchema
      }
    },
    conversationsList: {
      method: "GET",
      query: {
        schema: conversationsListQuerySchema,
        mode: "patch"
      },
      output: createCursorListValidator(conversationRecordOutputDefinition)
    },
    conversationMessagesList: {
      method: "GET",
      params: {
        schema: conversationMessagesParamsSchema,
        mode: "patch"
      },
      query: {
        schema: conversationMessagesQuerySchema,
        mode: "patch"
      },
      output: conversationMessagesOutputDefinition
    }
  }
});

export {
  MAX_INPUT_CHARS,
  MAX_HISTORY_MESSAGES,
  assistantResource
};
