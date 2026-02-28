import { createHash } from "node:crypto";
import { defaultHasPermission } from "@jskit-ai/assistant-core";
import { AppError as SharedAppError } from "@jskit-ai/server-runtime-core/errors";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { normalizePagination as normalizePaginationBase } from "@jskit-ai/server-runtime-core/pagination";
import { redactSecrets } from "./redactSecrets.js";
import {
  TRANSCRIPT_MODE_DISABLED,
  TRANSCRIPT_MODE_RESTRICTED,
  normalizeTranscriptMode,
  resolveTranscriptModeFromWorkspaceSettings
} from "./mode.js";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_EXPORT_LIMIT = 2_000;
const MAX_PAGE_SIZE = 200;
const MAX_EXPORT_LIMIT = 10_000;
const DEFAULT_CONVERSATION_TITLE = "New conversation";
const MAX_CONVERSATION_TITLE_LENGTH = 160;
const DEFAULT_CONSOLE_READ_PERMISSION = "";
const DEFAULT_CONSOLE_EXPORT_PERMISSION = "";
const TRANSCRIPT_SURFACE_IDS = Object.freeze(["app", "admin", "console"]);
const TRANSCRIPT_SURFACE_ID_SET = new Set(TRANSCRIPT_SURFACE_IDS);

const DefaultAppError = SharedAppError;

let AppError = DefaultAppError;

function defaultResolveRolePermissions() {
  return [];
}

let resolveRolePermissions = defaultResolveRolePermissions;
let hasPermission = defaultHasPermission;

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeTranscriptSurfaceId(value, { required = false } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    if (!required) {
      return "";
    }

    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          surfaceId: "surfaceId is required."
        }
      }
    });
  }

  if (!TRANSCRIPT_SURFACE_ID_SET.has(normalized)) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          surfaceId: "surfaceId must be one of: app, admin, console."
        }
      }
    });
  }

  return normalized;
}

function resolveConversationSurfaceId(conversation) {
  const metadata = normalizeObject(conversation?.metadata);
  return normalizeTranscriptSurfaceId(metadata.surfaceId, {
    required: false
  });
}

function assertConversationSurfaceMatch(conversation, requestedSurfaceId) {
  const requiredSurfaceId = normalizeTranscriptSurfaceId(requestedSurfaceId, {
    required: false
  });
  if (!requiredSurfaceId) {
    return;
  }

  const conversationSurfaceId = resolveConversationSurfaceId(conversation);
  if (conversationSurfaceId !== requiredSurfaceId) {
    throw new AppError(404, "Conversation not found.");
  }
}

function normalizePagination(pagination = {}) {
  return normalizePaginationBase(pagination, {
    defaultPage: DEFAULT_PAGE,
    defaultPageSize: DEFAULT_PAGE_SIZE,
    maxPageSize: MAX_PAGE_SIZE
  });
}

function normalizeExportLimit(value) {
  const parsed = parsePositiveInteger(value);
  if (!parsed) {
    return DEFAULT_EXPORT_LIMIT;
  }

  return Math.max(1, Math.min(MAX_EXPORT_LIMIT, parsed));
}

function normalizeDateInput(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          dateRange: "Date filters must be valid ISO timestamps."
        }
      }
    });
  }

  return parsed;
}

function normalizeConversationId(value) {
  const conversationId = parsePositiveInteger(value);
  if (!conversationId) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          conversationId: "conversationId must be a positive integer."
        }
      }
    });
  }

  return conversationId;
}

function normalizeWorkspaceId(workspace) {
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

function normalizeConversationStatus(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return "";
  }

  const allowed = new Set(["active", "completed", "failed", "aborted"]);
  if (!allowed.has(normalized)) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          status: "status must be one of: active, completed, failed, aborted."
        }
      }
    });
  }

  return normalized;
}

function normalizeConversationTitle(value) {
  const normalized = normalizeText(value) || DEFAULT_CONVERSATION_TITLE;
  if (normalized.length <= MAX_CONVERSATION_TITLE_LENGTH) {
    return normalized;
  }

  return normalized.slice(0, MAX_CONVERSATION_TITLE_LENGTH);
}

function normalizeExportFormat(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized || normalized === "json") {
    return "json";
  }
  if (normalized === "ndjson") {
    return "ndjson";
  }

  throw new AppError(400, "Validation failed.", {
    details: {
      fieldErrors: {
        format: "format must be json or ndjson."
      }
    }
  });
}

function maybeRecordTranscriptWriteMetric(observabilityService, { mode, kind, outcome }) {
  if (!observabilityService || typeof observabilityService.recordAiTranscriptWrite !== "function") {
    return;
  }

  observabilityService.recordAiTranscriptWrite({
    mode,
    kind,
    outcome
  });
}

function maybeRecordTranscriptRedactionMetric(observabilityService, { mode, redacted }) {
  if (!observabilityService || typeof observabilityService.recordAiTranscriptRedaction !== "function") {
    return;
  }

  observabilityService.recordAiTranscriptRedaction({
    mode,
    redacted: Boolean(redacted)
  });
}

function preparePersistedContent(content, transcriptMode) {
  const sourceText = String(content ?? "");
  const redaction = redactSecrets(sourceText);
  const mode = normalizeTranscriptMode(transcriptMode);

  if (mode === TRANSCRIPT_MODE_RESTRICTED) {
    const digest = sourceText ? createHash("sha256").update(sourceText, "utf8").digest("hex") : "";
    return {
      contentText: null,
      contentRedacted: redaction.redacted,
      redactionHits: {
        hitTypes: redaction.hitTypes,
        hitCount: redaction.hitCount,
        version: redaction.version,
        restricted: true
      },
      messageMetadata: {
        contentLength: sourceText.length,
        contentDigest: digest
      },
      redacted: redaction.redacted
    };
  }

  return {
    contentText: redaction.text,
    contentRedacted: redaction.redacted,
    redactionHits: {
      hitTypes: redaction.hitTypes,
      hitCount: redaction.hitCount,
      version: redaction.version
    },
    messageMetadata: {
      contentLength: sourceText.length
    },
    redacted: redaction.redacted
  };
}

function createService({
  conversationsRepository,
  messagesRepository,
  workspaceSettingsRepository,
  consoleMembershipsRepository,
  observabilityService = null,
  appErrorClass = null,
  hasPermissionFn = null,
  resolveRolePermissionsFn = null,
  consoleReadPermission = DEFAULT_CONSOLE_READ_PERMISSION,
  consoleExportPermission = DEFAULT_CONSOLE_EXPORT_PERMISSION
} = {}) {
  if (typeof appErrorClass === "function") {
    AppError = appErrorClass;
  } else {
    AppError = DefaultAppError;
  }
  resolveRolePermissions =
    typeof resolveRolePermissionsFn === "function" ? resolveRolePermissionsFn : defaultResolveRolePermissions;
  hasPermission = typeof hasPermissionFn === "function" ? hasPermissionFn : defaultHasPermission;

  if (
    !conversationsRepository ||
    !messagesRepository ||
    !workspaceSettingsRepository ||
    !consoleMembershipsRepository
  ) {
    throw new Error("transcript repositories are required.");
  }
  if (
    typeof conversationsRepository.insert !== "function" ||
    typeof conversationsRepository.findById !== "function" ||
    typeof conversationsRepository.updateById !== "function"
  ) {
    throw new Error("conversationsRepository methods are required.");
  }
  if (
    typeof messagesRepository.insert !== "function" ||
    typeof messagesRepository.listByConversationId !== "function"
  ) {
    throw new Error("messagesRepository methods are required.");
  }
  if (typeof workspaceSettingsRepository.ensureForWorkspaceId !== "function") {
    throw new Error("workspaceSettingsRepository.ensureForWorkspaceId is required.");
  }
  if (typeof consoleMembershipsRepository.findByUserId !== "function") {
    throw new Error("consoleMembershipsRepository.findByUserId is required.");
  }

  async function resolveWorkspaceTranscriptMode(workspaceId) {
    const numericWorkspaceId = normalizeWorkspaceId(workspaceId);
    const workspaceSettings = await workspaceSettingsRepository.ensureForWorkspaceId(numericWorkspaceId);
    return resolveTranscriptModeFromWorkspaceSettings(workspaceSettings);
  }

  async function findWorkspaceConversationForUser(workspaceId, actorUserId, conversationId) {
    if (!actorUserId) {
      return null;
    }

    if (typeof conversationsRepository.findByIdForWorkspaceAndUser === "function") {
      return conversationsRepository.findByIdForWorkspaceAndUser(conversationId, workspaceId, actorUserId);
    }

    const conversation = await conversationsRepository.findByIdForWorkspace(conversationId, workspaceId);
    if (!conversation) {
      return null;
    }

    return parsePositiveInteger(conversation.createdByUserId) === actorUserId ? conversation : null;
  }

  async function startConversationForTurn({ workspace, user, conversationId, messageId, provider, model, surfaceId } = {}) {
    const workspaceId = normalizeWorkspaceId(workspace);
    const transcriptMode = await resolveWorkspaceTranscriptMode(workspaceId);
    const actorUserId = resolveActorUserId(user);
    const normalizedSurfaceId = normalizeTranscriptSurfaceId(surfaceId || "app", {
      required: true
    });

    if (transcriptMode === TRANSCRIPT_MODE_DISABLED) {
      return {
        conversation: null,
        transcriptMode
      };
    }

    const existingConversationId = parsePositiveInteger(conversationId);
    if (existingConversationId) {
      const existingConversation = await findWorkspaceConversationForUser(
        workspaceId,
        actorUserId,
        existingConversationId
      );
      if (!existingConversation) {
        throw new AppError(404, "Conversation not found.");
      }
      assertConversationSurfaceMatch(existingConversation, normalizedSurfaceId);

      if (existingConversation.transcriptMode !== transcriptMode || existingConversation.status !== "active") {
        const updatedConversation = await conversationsRepository.updateById(existingConversation.id, {
          transcriptMode,
          status: "active",
          endedAt: null
        });
        return {
          conversation: updatedConversation,
          transcriptMode
        };
      }

      return {
        conversation: existingConversation,
        transcriptMode
      };
    }

    const createdConversation = await conversationsRepository.insert({
      workspaceId,
      createdByUserId: actorUserId,
      title: DEFAULT_CONVERSATION_TITLE,
      status: "active",
      transcriptMode,
      provider: normalizeText(provider),
      model: normalizeText(model),
      metadata: {
        firstMessageId: normalizeText(messageId),
        surfaceId: normalizedSurfaceId
      }
    });

    return {
      conversation: createdConversation,
      transcriptMode
    };
  }

  async function updateConversationTitle(conversation, title) {
    const conversationId = parsePositiveInteger(conversation?.id);
    if (!conversationId) {
      return null;
    }

    return conversationsRepository.updateById(conversationId, {
      title: normalizeConversationTitle(title)
    });
  }

  async function appendMessage({
    conversation,
    role,
    kind = "chat",
    clientMessageId = "",
    actorUserId = null,
    content = "",
    metadata = {}
  } = {}) {
    const conversationId = parsePositiveInteger(conversation?.id);
    if (!conversationId) {
      return null;
    }

    const transcriptMode = normalizeTranscriptMode(conversation?.transcriptMode);
    if (transcriptMode === TRANSCRIPT_MODE_DISABLED) {
      return null;
    }

    const normalizedRole = normalizeText(role).toLowerCase();
    const normalizedKind = normalizeText(kind).toLowerCase() || "chat";
    if (!normalizedRole) {
      throw new TypeError("appendMessage role is required.");
    }

    const contentPayload = preparePersistedContent(content, transcriptMode);
    const message = await messagesRepository.insert({
      conversationId,
      workspaceId: conversation.workspaceId,
      role: normalizedRole,
      kind: normalizedKind,
      clientMessageId: normalizeText(clientMessageId),
      actorUserId: parsePositiveInteger(actorUserId),
      contentText: contentPayload.contentText,
      contentRedacted: contentPayload.contentRedacted,
      redactionHits: contentPayload.redactionHits,
      metadata: {
        ...contentPayload.messageMetadata,
        transcriptMode,
        ...normalizeObject(metadata)
      }
    });

    await conversationsRepository.incrementMessageCount(conversationId, 1);
    maybeRecordTranscriptWriteMetric(observabilityService, {
      mode: transcriptMode,
      kind: normalizedKind,
      outcome: "success"
    });
    maybeRecordTranscriptRedactionMetric(observabilityService, {
      mode: transcriptMode,
      redacted: contentPayload.redacted
    });

    return message;
  }

  async function completeConversation(conversation, { status = "completed", metadata = {} } = {}) {
    const conversationId = parsePositiveInteger(conversation?.id);
    if (!conversationId) {
      return null;
    }

    const existingMetadata = normalizeObject(conversation?.metadata);
    return conversationsRepository.updateById(conversationId, {
      status: normalizeConversationStatus(status) || "completed",
      endedAt: new Date(),
      metadata: {
        ...existingMetadata,
        ...normalizeObject(metadata)
      }
    });
  }

  async function listWorkspaceConversations(workspace, query = {}) {
    const workspaceId = normalizeWorkspaceId(workspace);
    const pagination = normalizePagination(query);
    const requestedSurfaceId = normalizeTranscriptSurfaceId(query.surfaceId, {
      required: false
    });
    const filters = {
      workspaceId,
      createdByUserId: parsePositiveInteger(query.createdByUserId),
      status: query.status,
      surfaceId: requestedSurfaceId,
      from: normalizeDateInput(query.from),
      to: normalizeDateInput(query.to)
    };

    const total = await conversationsRepository.count(filters);
    const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
    const safePage = Math.min(pagination.page, totalPages);
    const entries = await conversationsRepository.list(filters, {
      page: safePage,
      pageSize: pagination.pageSize
    });

    return {
      entries,
      page: safePage,
      pageSize: pagination.pageSize,
      total,
      totalPages
    };
  }

  async function listWorkspaceConversationsForUser(workspace, user, query = {}) {
    const workspaceId = normalizeWorkspaceId(workspace);
    const actorUserId = resolveActorUserId(user, { required: true });
    const pagination = normalizePagination(query);
    const requestedSurfaceId = normalizeTranscriptSurfaceId(query.surfaceId, {
      required: false
    });
    const filters = {
      workspaceId,
      createdByUserId: actorUserId,
      status: query.status,
      surfaceId: requestedSurfaceId,
      from: normalizeDateInput(query.from),
      to: normalizeDateInput(query.to)
    };

    const total = await conversationsRepository.count(filters);
    const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
    const safePage = Math.min(pagination.page, totalPages);
    const entries = await conversationsRepository.list(filters, {
      page: safePage,
      pageSize: pagination.pageSize
    });

    return {
      entries,
      page: safePage,
      pageSize: pagination.pageSize,
      total,
      totalPages
    };
  }

  async function getWorkspaceConversationMessages(workspace, conversationIdValue, query = {}) {
    const workspaceId = normalizeWorkspaceId(workspace);
    const conversationId = normalizeConversationId(conversationIdValue);
    const requestedSurfaceId = normalizeTranscriptSurfaceId(query.surfaceId, {
      required: false
    });
    const conversation = await conversationsRepository.findByIdForWorkspace(conversationId, workspaceId);
    if (!conversation) {
      throw new AppError(404, "Conversation not found.");
    }
    assertConversationSurfaceMatch(conversation, requestedSurfaceId);

    const pagination = normalizePagination(query);
    const total = await messagesRepository.countByConversationIdForWorkspace(conversationId, workspaceId);
    const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
    const safePage = Math.min(pagination.page, totalPages);
    const entries = await messagesRepository.listByConversationIdForWorkspace(conversationId, workspaceId, {
      page: safePage,
      pageSize: pagination.pageSize
    });

    return {
      conversation,
      entries,
      page: safePage,
      pageSize: pagination.pageSize,
      total,
      totalPages
    };
  }

  async function getWorkspaceConversationMessagesForUser(workspace, user, conversationIdValue, query = {}) {
    const workspaceId = normalizeWorkspaceId(workspace);
    const actorUserId = resolveActorUserId(user, { required: true });
    const conversationId = normalizeConversationId(conversationIdValue);
    const requestedSurfaceId = normalizeTranscriptSurfaceId(query.surfaceId, {
      required: false
    });
    const conversation = await findWorkspaceConversationForUser(workspaceId, actorUserId, conversationId);
    if (!conversation) {
      throw new AppError(404, "Conversation not found.");
    }
    assertConversationSurfaceMatch(conversation, requestedSurfaceId);

    const pagination = normalizePagination(query);
    const total = await messagesRepository.countByConversationIdForWorkspace(conversationId, workspaceId);
    const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
    const safePage = Math.min(pagination.page, totalPages);
    const entries = await messagesRepository.listByConversationIdForWorkspace(conversationId, workspaceId, {
      page: safePage,
      pageSize: pagination.pageSize
    });

    return {
      conversation,
      entries,
      page: safePage,
      pageSize: pagination.pageSize,
      total,
      totalPages
    };
  }

  async function exportWorkspaceConversation(workspace, conversationIdValue, query = {}) {
    const workspaceId = normalizeWorkspaceId(workspace);
    const conversationId = normalizeConversationId(conversationIdValue);
    const requestedSurfaceId = normalizeTranscriptSurfaceId(query.surfaceId, {
      required: false
    });
    const conversation = await conversationsRepository.findByIdForWorkspace(conversationId, workspaceId);
    if (!conversation) {
      throw new AppError(404, "Conversation not found.");
    }
    assertConversationSurfaceMatch(conversation, requestedSurfaceId);

    const format = normalizeExportFormat(query.format);
    const limit = normalizeExportLimit(query.limit);
    const from = normalizeDateInput(query.from);
    const to = normalizeDateInput(query.to);
    const entries = await messagesRepository.exportByFilters({
      workspaceId,
      conversationId,
      from,
      to,
      limit
    });

    return {
      format,
      conversation,
      entries,
      exportedAt: new Date().toISOString()
    };
  }

  async function requireConsolePermission(user, permission) {
    const userId = parsePositiveInteger(user?.id);
    if (!userId) {
      throw new AppError(401, "Authentication required.");
    }

    const membership = await consoleMembershipsRepository.findByUserId(userId);
    if (
      !membership ||
      String(membership.status || "")
        .trim()
        .toLowerCase() !== "active"
    ) {
      throw new AppError(403, "Forbidden.");
    }

    const permissions = resolveRolePermissions(membership.roleId);
    if (!hasPermission(permissions, permission)) {
      throw new AppError(403, "Forbidden.");
    }

    return {
      userId,
      membership,
      permissions
    };
  }

  async function listConsoleConversations(user, query = {}) {
    await requireConsolePermission(user, consoleReadPermission);

    const pagination = normalizePagination(query);
    const filters = {
      workspaceId: parsePositiveInteger(query.workspaceId),
      status: query.status,
      from: normalizeDateInput(query.from),
      to: normalizeDateInput(query.to)
    };

    const total = await conversationsRepository.count(filters);
    const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
    const safePage = Math.min(pagination.page, totalPages);
    const entries = await conversationsRepository.list(filters, {
      page: safePage,
      pageSize: pagination.pageSize
    });

    return {
      entries,
      page: safePage,
      pageSize: pagination.pageSize,
      total,
      totalPages
    };
  }

  async function getConsoleConversationMessages(user, conversationIdValue, query = {}) {
    await requireConsolePermission(user, consoleReadPermission);

    const conversationId = normalizeConversationId(conversationIdValue);
    const conversation = await conversationsRepository.findById(conversationId);
    if (!conversation) {
      throw new AppError(404, "Conversation not found.");
    }

    const pagination = normalizePagination(query);
    const total = await messagesRepository.countByConversationId(conversationId);
    const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
    const safePage = Math.min(pagination.page, totalPages);
    const entries = await messagesRepository.listByConversationId(conversationId, {
      page: safePage,
      pageSize: pagination.pageSize
    });

    return {
      conversation,
      entries,
      page: safePage,
      pageSize: pagination.pageSize,
      total,
      totalPages
    };
  }

  async function exportConsoleMessages(user, query = {}) {
    await requireConsolePermission(user, consoleExportPermission);

    const format = normalizeExportFormat(query.format);
    const from = normalizeDateInput(query.from);
    const to = normalizeDateInput(query.to);
    if (!from && !to && !parsePositiveInteger(query.conversationId)) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            dateRange: "from or to filter is required for console exports."
          }
        }
      });
    }

    const limit = normalizeExportLimit(query.limit);
    const entries = await messagesRepository.exportByFilters({
      workspaceId: parsePositiveInteger(query.workspaceId),
      conversationId: parsePositiveInteger(query.conversationId),
      role: normalizeText(query.role).toLowerCase(),
      from,
      to,
      limit
    });

    return {
      format,
      entries,
      exportedAt: new Date().toISOString()
    };
  }

  return {
    resolveWorkspaceTranscriptMode,
    startConversationForTurn,
    updateConversationTitle,
    appendMessage,
    completeConversation,
    listWorkspaceConversations,
    listWorkspaceConversationsForUser,
    getWorkspaceConversationMessages,
    getWorkspaceConversationMessagesForUser,
    exportWorkspaceConversation,
    listConsoleConversations,
    getConsoleConversationMessages,
    exportConsoleMessages
  };
}

const __testables = {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_EXPORT_LIMIT,
  MAX_PAGE_SIZE,
  MAX_EXPORT_LIMIT,
  DEFAULT_CONVERSATION_TITLE,
  MAX_CONVERSATION_TITLE_LENGTH,
  normalizeObject,
  normalizeText,
  normalizeConversationTitle,
  normalizePagination,
  normalizeExportLimit,
  normalizeDateInput,
  normalizeConversationId,
  normalizeWorkspaceId,
  normalizeConversationStatus,
  normalizeExportFormat,
  preparePersistedContent,
  normalizeTranscriptSurfaceId,
  resolveConversationSurfaceId,
  assertConversationSurfaceMatch
};

export { createService, __testables };
