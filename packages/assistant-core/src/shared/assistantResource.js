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

const historyMessageSchema = createSchema({
  role: {
    type: "string",
    required: true,
    enum: ["user", "assistant"]
  },
  content: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: MAX_INPUT_CHARS
  }
});

const clientContextSchema = createSchema({
  locale: {
    type: "string",
    required: false,
    maxLength: 64
  },
  timezone: {
    type: "string",
    required: false,
    maxLength: 64
  }
});

const chatStreamBodySchema = createSchema({
  messageId: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: 128
  },
  conversationId: {
    type: "string",
    required: false,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  },
  input: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: MAX_INPUT_CHARS
  },
  history: {
    type: "array",
    required: false,
    maxItems: MAX_HISTORY_MESSAGES,
    items: historyMessageSchema
  },
  clientContext: {
    type: "object",
    required: false,
    schema: clientContextSchema
  }
});

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

const conversationRecordSchema = createSchema({
  id: {
    type: "string",
    required: true,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  },
  workspaceId: {
    type: "string",
    required: true,
    nullable: true,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  },
  title: {
    type: "string",
    required: true
  },
  createdByUserId: {
    type: "string",
    required: true,
    nullable: true,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  },
  status: {
    type: "string",
    required: true
  },
  provider: {
    type: "string",
    required: true
  },
  model: {
    type: "string",
    required: true
  },
  surfaceId: {
    type: "string",
    required: true
  },
  startedAt: {
    type: "string",
    required: true,
    minLength: 1
  },
  endedAt: {
    type: "string",
    required: true,
    nullable: true,
    minLength: 1
  },
  messageCount: {
    type: "integer",
    required: true,
    min: 0
  },
  metadata: {
    type: "object",
    required: true,
    additionalProperties: true
  },
  createdAt: {
    type: "string",
    required: true,
    minLength: 1
  },
  updatedAt: {
    type: "string",
    required: true,
    minLength: 1
  }
});

const conversationRecordOutputDefinition = deepFreeze({
  schema: conversationRecordSchema,
  mode: "replace"
});

const messageRecordSchema = createSchema({
  id: {
    type: "string",
    required: true,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  },
  conversationId: {
    type: "string",
    required: true,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  },
  workspaceId: {
    type: "string",
    required: true,
    nullable: true,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  },
  seq: {
    type: "integer",
    required: true,
    min: 1
  },
  role: {
    type: "string",
    required: true,
    minLength: 1
  },
  kind: {
    type: "string",
    required: true,
    minLength: 1
  },
  clientMessageSid: {
    type: "string",
    required: true
  },
  actorUserId: {
    type: "string",
    required: true,
    nullable: true,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  },
  contentText: {
    type: "string",
    required: true,
    nullable: true
  },
  metadata: {
    type: "object",
    required: true,
    additionalProperties: true
  },
  createdAt: {
    type: "string",
    required: true,
    minLength: 1
  }
});

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
  schema: createSchema({
    page: {
      type: "integer",
      required: true,
      min: 1
    },
    pageSize: {
      type: "integer",
      required: true,
      min: 1
    },
    total: {
      type: "integer",
      required: true,
      min: 0
    },
    totalPages: {
      type: "integer",
      required: true,
      min: 1
    },
    conversation: {
      type: "object",
      required: true,
      schema: conversationRecordSchema
    },
    entries: {
      type: "array",
      required: true,
      items: messageRecordSchema
    }
  }),
  mode: "replace"
});

const assistantResource = deepFreeze({
  namespace: "assistant",
  operations: {
    chatStream: {
      method: "POST",
      body: {
        schema: chatStreamBodySchema,
        mode: "create"
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
