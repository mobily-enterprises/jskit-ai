import { AppError, parsePositiveInteger } from "@jskit-ai/kernel/server/runtime";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { ASSISTANT_TRANSCRIPT_CHANGED_EVENT } from "../../shared/streamEvents.js";
import { normalizeConversationStatus } from "../../shared/support/conversationStatus.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;
const DEFAULT_MESSAGES_PAGE_SIZE = 200;
const MAX_MESSAGES_PAGE_SIZE = 500;
const DEFAULT_CONVERSATION_TITLE = "New conversation";
const MAX_CONVERSATION_TITLE_LENGTH = 80;

const serviceEvents = Object.freeze({
  createConversationForTurn: Object.freeze([
    Object.freeze({
      type: "entity.changed",
      source: "assistant",
      entity: "conversation",
      operation: ({ result }) => (result?.created === true ? "created" : "updated"),
      entityId: ({ result }) => result?.conversation?.id,
      realtime: Object.freeze({
        event: ASSISTANT_TRANSCRIPT_CHANGED_EVENT,
        audience: "event_scope",
        payload: ({ result }) => ({
          conversationId: result?.conversation?.id || null
        })
      })
    })
  ]),
  appendMessage: Object.freeze([
    Object.freeze({
      type: "entity.changed",
      source: "assistant",
      entity: "conversation",
      operation: "updated",
      entityId: ({ result }) => result?.conversationId,
      realtime: Object.freeze({
        event: ASSISTANT_TRANSCRIPT_CHANGED_EVENT,
        audience: "event_scope",
        payload: ({ result }) => ({
          conversationId: result?.conversationId || null
        })
      })
    })
  ]),
  completeConversation: Object.freeze([
    Object.freeze({
      type: "entity.changed",
      source: "assistant",
      entity: "conversation",
      operation: "updated",
      entityId: ({ result }) => result?.id,
      realtime: Object.freeze({
        event: ASSISTANT_TRANSCRIPT_CHANGED_EVENT,
        audience: "event_scope",
        payload: ({ result }) => ({
          conversationId: result?.id || null
        })
      })
    })
  ])
});

function resolveWorkspaceId(workspace) {
  const workspaceId = parsePositiveInteger(workspace?.id || workspace);
  if (!workspaceId) {
    throw new AppError(409, "Workspace selection required.");
  }

  return workspaceId;
}

function resolveActorUserId(user, { required = false } = {}) {
  const actorUserId = parsePositiveInteger(user?.id);
  if (!actorUserId && required) {
    throw new AppError(401, "Authentication required.");
  }

  return actorUserId;
}

function normalizePagination(pagination = {}, { defaultPageSize = DEFAULT_PAGE_SIZE, maxPageSize = MAX_PAGE_SIZE } = {}) {
  const page = Math.max(1, parsePositiveInteger(pagination.page) || 1);
  const pageSize = Math.max(1, Math.min(maxPageSize, parsePositiveInteger(pagination.pageSize) || defaultPageSize));

  return {
    page,
    pageSize
  };
}

function normalizeCursorPagination(query = {}, { defaultLimit = DEFAULT_PAGE_SIZE, maxLimit = MAX_PAGE_SIZE } = {}) {
  const cursor = parsePositiveInteger(query.cursor) || 0;
  const limit = Math.max(1, Math.min(maxLimit, parsePositiveInteger(query.limit) || defaultLimit));

  return {
    cursor,
    limit
  };
}

function deriveConversationTitleFromMessage(contentText) {
  const normalized = String(contentText == null ? "" : contentText).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  return normalized.slice(0, MAX_CONVERSATION_TITLE_LENGTH).trim();
}

function isDefaultConversationTitle(value) {
  return normalizeText(value).toLowerCase() === DEFAULT_CONVERSATION_TITLE.toLowerCase();
}

function createTranscriptService({ conversationsRepository, messagesRepository } = {}) {
  if (!conversationsRepository || !messagesRepository) {
    throw new Error("createTranscriptService requires conversationsRepository and messagesRepository.");
  }

  async function createConversationForTurn(workspace, user, options = {}) {
    const workspaceId = resolveWorkspaceId(workspace);
    const actorUserId = resolveActorUserId(user, {
      required: true
    });
    const source = normalizeObject(options);
    const conversationId = parsePositiveInteger(source.conversationId);

    if (conversationId) {
      const existing = await conversationsRepository.findByIdForWorkspaceAndUser(conversationId, workspaceId, actorUserId);
      if (!existing) {
        throw new AppError(404, "Conversation not found.");
      }

      if (existing.status !== "active") {
        const reopened = await conversationsRepository.updateById(existing.id, {
          status: "active",
          endedAt: null
        });

        return {
          conversation: reopened,
          created: false
        };
      }

      return {
        conversation: existing,
        created: false
      };
    }

    const createdConversation = await conversationsRepository.create({
      workspaceId,
      createdByUserId: actorUserId,
      title: normalizeText(source.title) || DEFAULT_CONVERSATION_TITLE,
      status: "active",
      provider: normalizeText(source.provider),
      model: normalizeText(source.model),
      surfaceId: normalizeText(source.surfaceId).toLowerCase() || "admin",
      metadata: {
        firstMessageId: normalizeText(source.messageId)
      }
    });

    return {
      conversation: createdConversation,
      created: true
    };
  }

  async function appendMessage(conversationId, payload = {}, options = {}) {
    const numericConversationId = parsePositiveInteger(conversationId);
    if (!numericConversationId) {
      throw new TypeError("appendMessage requires conversationId.");
    }

    const source = normalizeObject(payload);
    const context = normalizeObject(options.context);
    const conversation = await conversationsRepository.findById(numericConversationId);
    if (!conversation) {
      throw new AppError(404, "Conversation not found.");
    }

    const actorUserId = parsePositiveInteger(source.actorUserId) || resolveActorUserId(context.actor) || null;
    const createdMessage = await messagesRepository.create({
      conversationId: numericConversationId,
      workspaceId: conversation.workspaceId,
      role: normalizeText(source.role).toLowerCase(),
      kind: normalizeText(source.kind).toLowerCase() || "chat",
      clientMessageId: normalizeText(source.clientMessageId),
      actorUserId,
      contentText: source.contentText == null ? null : String(source.contentText),
      metadata: normalizeObject(source.metadata)
    });

    await conversationsRepository.incrementMessageCount(numericConversationId, 1);

    const messageRole = normalizeText(source.role).toLowerCase();
    const messageKind = normalizeText(source.kind).toLowerCase() || "chat";
    if (messageRole === "user" && messageKind === "chat" && isDefaultConversationTitle(conversation.title)) {
      const derivedTitle = deriveConversationTitleFromMessage(source.contentText);
      if (derivedTitle) {
        await conversationsRepository.updateById(numericConversationId, {
          title: derivedTitle
        });
      }
    }

    return {
      conversationId: numericConversationId,
      message: createdMessage
    };
  }

  async function completeConversation(conversationId, payload = {}) {
    const numericConversationId = parsePositiveInteger(conversationId);
    if (!numericConversationId) {
      throw new TypeError("completeConversation requires conversationId.");
    }

    const source = normalizeObject(payload);
    const existing = await conversationsRepository.findById(numericConversationId);
    if (!existing) {
      throw new AppError(404, "Conversation not found.");
    }

    return conversationsRepository.updateById(numericConversationId, {
      status: normalizeConversationStatus(source.status, {
        fallback: "completed"
      }),
      endedAt: source.endedAt || new Date(),
      metadata: {
        ...normalizeObject(existing.metadata),
        ...normalizeObject(source.metadata)
      }
    });
  }

  async function listConversationsForUser(workspace, user, query = {}) {
    const workspaceId = resolveWorkspaceId(workspace);
    const actorUserId = resolveActorUserId(user, {
      required: true
    });
    const pagination = normalizeCursorPagination(query, {
      defaultLimit: DEFAULT_PAGE_SIZE,
      maxLimit: MAX_PAGE_SIZE
    });

    const status = normalizeConversationStatus(query.status, {
      fallback: ""
    });
    const filters = {
      ...(status ? { status } : {})
    };

    return conversationsRepository.listForWorkspaceAndUser(
      workspaceId,
      actorUserId,
      {
        cursor: pagination.cursor,
        limit: pagination.limit
      },
      filters
    );
  }

  async function getConversationMessagesForUser(workspace, user, conversationId, query = {}) {
    const workspaceId = resolveWorkspaceId(workspace);
    const actorUserId = resolveActorUserId(user, {
      required: true
    });
    const numericConversationId = parsePositiveInteger(conversationId);
    if (!numericConversationId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            conversationId: "conversationId must be a positive integer."
          }
        }
      });
    }

    const conversation = await conversationsRepository.findByIdForWorkspaceAndUser(
      numericConversationId,
      workspaceId,
      actorUserId
    );
    if (!conversation) {
      throw new AppError(404, "Conversation not found.");
    }

    const pagination = normalizePagination(query, {
      defaultPageSize: DEFAULT_MESSAGES_PAGE_SIZE,
      maxPageSize: MAX_MESSAGES_PAGE_SIZE
    });
    const total = await messagesRepository.countByConversationForWorkspace(numericConversationId, workspaceId);
    const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
    const page = Math.min(pagination.page, totalPages);
    const entries = await messagesRepository.listByConversationForWorkspace(
      numericConversationId,
      workspaceId,
      {
        page,
        pageSize: pagination.pageSize
      }
    );

    return {
      conversation,
      entries,
      page,
      pageSize: pagination.pageSize,
      total,
      totalPages
    };
  }

  return Object.freeze({
    createConversationForTurn,
    appendMessage,
    completeConversation,
    listConversationsForUser,
    getConversationMessagesForUser
  });
}

export {
  createTranscriptService,
  serviceEvents
};
