import { Type } from "typebox";
import {
  normalizeObjectInput,
  createCursorListValidator
} from "@jskit-ai/kernel/shared/validators";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeConversationStatus } from "./support/conversationStatus.js";
import { toPositiveInteger } from "./support/positiveInteger.js";

const MAX_INPUT_CHARS = 8000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_PAGE_SIZE = 200;
const MAX_MESSAGE_PAGE_SIZE = 500;

function normalizePaginationValue(value, fallback, max) {
  const parsed = toPositiveInteger(value, fallback);
  return Math.max(1, Math.min(max, parsed));
}

function normalizeChatStreamBody(payload = {}) {
  const source = normalizeObjectInput(payload);
  const normalized = {
    messageId: normalizeText(source.messageId),
    input: normalizeText(source.input)
  };

  const conversationId = toPositiveInteger(source.conversationId, 0);
  if (conversationId > 0) {
    normalized.conversationId = conversationId;
  }

  const history = Array.isArray(source.history) ? source.history : [];
  normalized.history = history
    .slice(0, MAX_HISTORY_MESSAGES)
    .map((entry) => {
      const item = normalizeObjectInput(entry);
      const role = normalizeText(item.role).toLowerCase();
      if (role !== "user" && role !== "assistant") {
        return null;
      }

      const content = normalizeText(item.content);
      if (!content) {
        return null;
      }

      return {
        role,
        content: content.slice(0, MAX_INPUT_CHARS)
      };
    })
    .filter(Boolean);

  const clientContext = normalizeObjectInput(source.clientContext);
  if (Object.keys(clientContext).length > 0) {
    normalized.clientContext = {
      locale: normalizeText(clientContext.locale),
      timezone: normalizeText(clientContext.timezone)
    };
  }

  return normalized;
}

function normalizeConversationsListQuery(payload = {}) {
  const source = normalizeObjectInput(payload);
  const status = normalizeConversationStatus(source.status, {
    fallback: ""
  });
  const normalized = {};

  if (Object.hasOwn(source, "cursor")) {
    normalized.cursor = toPositiveInteger(source.cursor, 0);
  }
  if (Object.hasOwn(source, "limit")) {
    normalized.limit = toPositiveInteger(source.limit, 0);
  }
  if (status) {
    normalized.status = status;
  }

  return normalized;
}

function normalizeConversationMessagesQuery(payload = {}) {
  const source = normalizeObjectInput(payload);

  return {
    page: normalizePaginationValue(source.page, 1, MAX_MESSAGE_PAGE_SIZE),
    pageSize: normalizePaginationValue(source.pageSize, 200, MAX_MESSAGE_PAGE_SIZE)
  };
}

function normalizeConversationMessagesParams(payload = {}) {
  const source = normalizeObjectInput(payload);
  return {
    conversationId: toPositiveInteger(source.conversationId, 0)
  };
}

function createOptionalPositiveIntegerQuerySchema(max = null) {
  const numericSchema = max == null
    ? Type.Integer({ minimum: 1 })
    : Type.Integer({ minimum: 1, maximum: max });

  return Type.Optional(
    Type.Union([
      numericSchema,
      Type.String({ pattern: "^[1-9][0-9]*$" })
    ])
  );
}

function normalizeConversationRecord(payload = {}) {
  const source = normalizeObjectInput(payload);

  return {
    id: toPositiveInteger(source.id, 0),
    workspaceId: toPositiveInteger(source.workspaceId, 0),
    workspaceSlug: normalizeText(source.workspaceSlug),
    workspaceName: normalizeText(source.workspaceName),
    title: normalizeText(source.title),
    createdByUserId: toPositiveInteger(source.createdByUserId, 0) || null,
    createdByUserDisplayName: normalizeText(source.createdByUserDisplayName),
    createdByUserEmail: normalizeText(source.createdByUserEmail),
    status: normalizeText(source.status),
    provider: normalizeText(source.provider),
    model: normalizeText(source.model),
    surfaceId: normalizeText(source.surfaceId),
    startedAt: normalizeText(source.startedAt),
    endedAt: normalizeText(source.endedAt) || null,
    messageCount: Math.max(0, Number(source.messageCount || 0)),
    metadata: normalizeObjectInput(source.metadata),
    createdAt: normalizeText(source.createdAt),
    updatedAt: normalizeText(source.updatedAt)
  };
}

function normalizeConversationMessageRecord(payload = {}) {
  const source = normalizeObjectInput(payload);

  return {
    id: toPositiveInteger(source.id, 0),
    conversationId: toPositiveInteger(source.conversationId, 0),
    workspaceId: toPositiveInteger(source.workspaceId, 0),
    seq: toPositiveInteger(source.seq, 0),
    role: normalizeText(source.role),
    kind: normalizeText(source.kind),
    clientMessageId: normalizeText(source.clientMessageId),
    actorUserId: toPositiveInteger(source.actorUserId, 0) || null,
    contentText: source.contentText == null ? null : String(source.contentText),
    metadata: normalizeObjectInput(source.metadata),
    createdAt: normalizeText(source.createdAt)
  };
}

const historyMessageSchema = Type.Object(
  {
    role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
    content: Type.String({ minLength: 1, maxLength: MAX_INPUT_CHARS })
  },
  { additionalProperties: false }
);

const chatStreamBodySchema = Type.Object(
  {
    messageId: Type.String({ minLength: 1, maxLength: 128 }),
    conversationId: Type.Optional(Type.Integer({ minimum: 1 })),
    input: Type.String({ minLength: 1, maxLength: MAX_INPUT_CHARS }),
    history: Type.Optional(Type.Array(historyMessageSchema, { maxItems: MAX_HISTORY_MESSAGES })),
    clientContext: Type.Optional(
      Type.Object(
        {
          locale: Type.Optional(Type.String({ maxLength: 64 })),
          timezone: Type.Optional(Type.String({ maxLength: 64 }))
        },
        { additionalProperties: false }
      )
    )
  },
  {
    additionalProperties: false
  }
);

const conversationRecordSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    workspaceId: Type.Integer({ minimum: 1 }),
    workspaceSlug: Type.String(),
    workspaceName: Type.String(),
    title: Type.String(),
    createdByUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    createdByUserDisplayName: Type.String(),
    createdByUserEmail: Type.String(),
    status: Type.String(),
    provider: Type.String(),
    model: Type.String(),
    surfaceId: Type.String(),
    startedAt: Type.String({ minLength: 1 }),
    endedAt: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    messageCount: Type.Integer({ minimum: 0 }),
    metadata: Type.Record(Type.String(), Type.Unknown()),
    createdAt: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const conversationRecordValidator = Object.freeze({
  schema: conversationRecordSchema,
  normalize: normalizeConversationRecord
});

const messageRecordSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    conversationId: Type.Integer({ minimum: 1 }),
    workspaceId: Type.Integer({ minimum: 1 }),
    seq: Type.Integer({ minimum: 1 }),
    role: Type.String({ minLength: 1 }),
    kind: Type.String({ minLength: 1 }),
    clientMessageId: Type.String(),
    actorUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    contentText: Type.Union([Type.String(), Type.Null()]),
    metadata: Type.Record(Type.String(), Type.Unknown()),
    createdAt: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const paginationProperties = Object.freeze({
  page: Type.Integer({ minimum: 1 }),
  pageSize: Type.Integer({ minimum: 1 }),
  total: Type.Integer({ minimum: 0 }),
  totalPages: Type.Integer({ minimum: 1 })
});

const assistantResource = Object.freeze({
  resource: "assistant",
  operations: {
    chatStream: {
      method: "POST",
      bodyValidator: Object.freeze({
        schema: chatStreamBodySchema,
        normalize: normalizeChatStreamBody
      })
    },
    conversationsList: {
      method: "GET",
      queryValidator: Object.freeze({
        schema: Type.Object(
          {
            cursor: createOptionalPositiveIntegerQuerySchema(),
            limit: createOptionalPositiveIntegerQuerySchema(MAX_PAGE_SIZE),
            status: Type.Optional(Type.String({ minLength: 1, maxLength: 32 }))
          },
          { additionalProperties: false }
        ),
        normalize: normalizeConversationsListQuery
      }),
      outputValidator: createCursorListValidator(conversationRecordValidator)
    },
    conversationMessagesList: {
      method: "GET",
      paramsValidator: Object.freeze({
        schema: Type.Object(
          {
            conversationId: Type.Union([
              Type.Integer({ minimum: 1 }),
              Type.String({ pattern: "^[1-9][0-9]*$" })
            ])
          },
          { additionalProperties: false }
        ),
        normalize: normalizeConversationMessagesParams
      }),
      queryValidator: Object.freeze({
        schema: Type.Object(
          {
            page: createOptionalPositiveIntegerQuerySchema(),
            pageSize: createOptionalPositiveIntegerQuerySchema(MAX_MESSAGE_PAGE_SIZE)
          },
          { additionalProperties: false }
        ),
        normalize: normalizeConversationMessagesQuery
      }),
      outputValidator: Object.freeze({
        schema: Type.Object(
          {
            ...paginationProperties,
            conversation: conversationRecordSchema,
            entries: Type.Array(messageRecordSchema)
          },
          { additionalProperties: false }
        ),
        normalize(payload = {}) {
          const source = normalizeObjectInput(payload);
          return {
            conversation: normalizeConversationRecord(source.conversation),
            entries: (Array.isArray(source.entries) ? source.entries : []).map(normalizeConversationMessageRecord),
            page: normalizePaginationValue(source.page, 1, MAX_MESSAGE_PAGE_SIZE),
            pageSize: normalizePaginationValue(source.pageSize, 200, MAX_MESSAGE_PAGE_SIZE),
            total: Math.max(0, Number(source.total || 0)),
            totalPages: Math.max(1, Number(source.totalPages || 1))
          };
        }
      })
    }
  }
});

export {
  MAX_INPUT_CHARS,
  MAX_HISTORY_MESSAGES,
  assistantResource
};
