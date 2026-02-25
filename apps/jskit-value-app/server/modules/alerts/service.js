import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../../shared/eventTypes.js";

const ALERT_ENTITY_TYPE = "user_alert";

function validationError(fieldErrors) {
  return new AppError(400, "Validation failed.", {
    details: {
      fieldErrors
    }
  });
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeRequiredPositiveInteger(value, fieldName) {
  const parsed = parsePositiveInteger(value);
  if (!parsed) {
    throw validationError({
      [fieldName]: `${fieldName} must be a positive integer.`
    });
  }

  return parsed;
}

function normalizeOptionalPositiveInteger(value, fieldName) {
  if (value == null || value === "") {
    return null;
  }

  const parsed = parsePositiveInteger(value);
  if (!parsed) {
    throw validationError({
      [fieldName]: `${fieldName} must be a positive integer.`
    });
  }

  return parsed;
}

function normalizeTargetUrl(value) {
  const targetUrl = normalizeText(value);
  const fieldErrors = {};

  if (!targetUrl) {
    fieldErrors.targetUrl = "targetUrl is required.";
  } else {
    const lower = targetUrl.toLowerCase();

    if (!targetUrl.startsWith("/")) {
      fieldErrors.targetUrl = "targetUrl must start with /.";
    } else if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("//")) {
      fieldErrors.targetUrl = "targetUrl must be an in-app path.";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw validationError(fieldErrors);
  }

  return targetUrl;
}

function normalizeType(value) {
  const type = normalizeText(value).toLowerCase();
  if (!type) {
    throw validationError({
      type: "type is required."
    });
  }
  if (type.length > 80) {
    throw validationError({
      type: "type must be at most 80 characters."
    });
  }

  return type;
}

function normalizeTitle(value) {
  const title = normalizeText(value);
  if (!title) {
    throw validationError({
      title: "title is required."
    });
  }
  if (title.length > 200) {
    throw validationError({
      title: "title must be at most 200 characters."
    });
  }

  return title;
}

function normalizeMessage(value) {
  const message = normalizeNullableText(value);
  if (message == null) {
    return null;
  }

  if (message.length > 1000) {
    throw validationError({
      message: "message must be at most 1000 characters."
    });
  }

  return message;
}

function normalizePayloadJson(value) {
  if (value == null || value === "") {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return value;
}

function normalizePagination(input = {}) {
  const page = Math.max(1, Number(input?.page) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(input?.pageSize) || 20));

  return {
    page,
    pageSize
  };
}

function normalizeReadThroughAlertId(value) {
  const parsed = parsePositiveInteger(value);
  return parsed || null;
}

function mapEntryWithReadStatus(entry, readThroughAlertId) {
  return {
    ...entry,
    isUnread: Number(entry?.id) > Number(readThroughAlertId || 0)
  };
}

function normalizeAuthenticatedUser(user) {
  const userId = parsePositiveInteger(user?.id);
  if (!userId) {
    throw new AppError(401, "Authentication required.");
  }

  return {
    ...user,
    id: userId
  };
}

function resolveRealtimeEventsDependency({ realtimeEventsService = null, resolveRealtimeEventsService = null } = {}) {
  if (typeof resolveRealtimeEventsService === "function") {
    const resolvedService = resolveRealtimeEventsService();
    if (resolvedService && typeof resolvedService.publish === "function") {
      return resolvedService;
    }
  }

  if (realtimeEventsService && typeof realtimeEventsService.publish === "function") {
    return realtimeEventsService;
  }

  return null;
}

function buildAlertCreatedRealtimeEvent(alert) {
  const userId = parsePositiveInteger(alert?.userId);
  if (!userId) {
    return null;
  }

  return {
    eventType: REALTIME_EVENT_TYPES.USER_ALERT_CREATED,
    topic: REALTIME_TOPICS.ALERTS,
    entityType: ALERT_ENTITY_TYPE,
    entityId: parsePositiveInteger(alert?.id) || "none",
    workspaceId: parsePositiveInteger(alert?.workspaceId) || null,
    actorUserId: parsePositiveInteger(alert?.actorUserId) || null,
    payload: {
      alertId: parsePositiveInteger(alert?.id) || null,
      userId,
      type: normalizeText(alert?.type).toLowerCase(),
      targetUrl: normalizeText(alert?.targetUrl)
    },
    targetUserIds: [userId]
  };
}

function publishAlertCreatedRealtimeEventSafely(alert, realtimeEventsService) {
  if (!realtimeEventsService || typeof realtimeEventsService.publish !== "function") {
    return false;
  }

  const realtimeEventInput = buildAlertCreatedRealtimeEvent(alert);
  if (!realtimeEventInput) {
    return false;
  }

  let eventEnvelope = realtimeEventInput;
  if (typeof realtimeEventsService.createEventEnvelope === "function") {
    eventEnvelope = {
      ...realtimeEventsService.createEventEnvelope(realtimeEventInput),
      targetUserIds: realtimeEventInput.targetUserIds
    };
  }

  try {
    realtimeEventsService.publish(eventEnvelope);
    return true;
  } catch {
    return false;
  }
}

function createService({ alertsRepository, realtimeEventsService = null, resolveRealtimeEventsService = null } = {}) {
  if (!alertsRepository) {
    throw new Error("alertsRepository is required.");
  }

  async function listForUser(user, paginationInput = {}) {
    const normalizedUser = normalizeAuthenticatedUser(user);
    const { page, pageSize } = normalizePagination(paginationInput);

    const readState = await alertsRepository.getReadStateForUser(normalizedUser.id);
    const readThroughAlertId = normalizeReadThroughAlertId(readState?.readThroughAlertId);

    const total = await alertsRepository.countAlertsForUser(normalizedUser.id);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);

    const entries = await alertsRepository.listAlertsForUser(normalizedUser.id, safePage, pageSize);
    const unreadCount = await alertsRepository.countUnreadAlertsForUser(normalizedUser.id, readThroughAlertId);

    return {
      entries: entries.map((entry) => mapEntryWithReadStatus(entry, readThroughAlertId)),
      page: safePage,
      pageSize,
      total,
      totalPages,
      unreadCount,
      readThroughAlertId
    };
  }

  async function markAllReadForUser(user) {
    const normalizedUser = normalizeAuthenticatedUser(user);

    return alertsRepository.transaction(async (trx) => {
      const transactionOptions = trx ? { trx } : {};
      const latestAlertId = await alertsRepository.getLatestAlertIdForUser(normalizedUser.id, transactionOptions);
      const readState = await alertsRepository.upsertReadStateForUser(
        normalizedUser.id,
        latestAlertId,
        transactionOptions
      );

      return {
        unreadCount: 0,
        readThroughAlertId: normalizeReadThroughAlertId(readState?.readThroughAlertId)
      };
    });
  }

  async function createAlert(input = {}) {
    const resolvedRealtimeEventsService = resolveRealtimeEventsDependency({
      realtimeEventsService,
      resolveRealtimeEventsService
    });
    const source = input && typeof input === "object" ? input : {};

    const fieldErrors = {};
    const userId = parsePositiveInteger(source.userId);
    if (!userId) {
      fieldErrors.userId = "userId is required.";
    }

    const type = normalizeText(source.type).toLowerCase();
    if (!type) {
      fieldErrors.type = "type is required.";
    } else if (type.length > 80) {
      fieldErrors.type = "type must be at most 80 characters.";
    }

    const title = normalizeText(source.title);
    if (!title) {
      fieldErrors.title = "title is required.";
    } else if (title.length > 200) {
      fieldErrors.title = "title must be at most 200 characters.";
    }

    const message = normalizeNullableText(source.message);
    if (message != null && message.length > 1000) {
      fieldErrors.message = "message must be at most 1000 characters.";
    }

    const targetUrl = normalizeText(source.targetUrl);
    if (!targetUrl) {
      fieldErrors.targetUrl = "targetUrl is required.";
    } else {
      const lowerTargetUrl = targetUrl.toLowerCase();
      if (!targetUrl.startsWith("/")) {
        fieldErrors.targetUrl = "targetUrl must start with /.";
      } else if (
        lowerTargetUrl.startsWith("http://") ||
        lowerTargetUrl.startsWith("https://") ||
        lowerTargetUrl.startsWith("//")
      ) {
        fieldErrors.targetUrl = "targetUrl must be an in-app path.";
      }
    }

    const actorUserId =
      source.actorUserId == null || source.actorUserId === "" ? null : parsePositiveInteger(source.actorUserId);
    if (source.actorUserId != null && source.actorUserId !== "" && !actorUserId) {
      fieldErrors.actorUserId = "actorUserId must be a positive integer.";
    }

    const workspaceId =
      source.workspaceId == null || source.workspaceId === "" ? null : parsePositiveInteger(source.workspaceId);
    if (source.workspaceId != null && source.workspaceId !== "" && !workspaceId) {
      fieldErrors.workspaceId = "workspaceId must be a positive integer.";
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw validationError(fieldErrors);
    }

    const createdAlert = await alertsRepository.insertAlert({
      userId,
      type,
      title,
      message,
      targetUrl,
      payloadJson: normalizePayloadJson(source.payloadJson),
      actorUserId,
      workspaceId
    });

    publishAlertCreatedRealtimeEventSafely(createdAlert, resolvedRealtimeEventsService);
    return createdAlert;
  }

  async function createWorkspaceInviteAlert({
    userId,
    workspaceId = null,
    workspaceName = "",
    roleId = "member",
    actorUserId = null
  } = {}) {
    const normalizedWorkspaceName = normalizeNullableText(workspaceName) || "a workspace";
    const normalizedRoleId = normalizeNullableText(roleId) || "member";

    return createAlert({
      userId: normalizeRequiredPositiveInteger(userId, "userId"),
      type: "workspace.invite.received",
      title: "Workspace invite",
      message: `You were invited to ${normalizedWorkspaceName} as ${normalizedRoleId}.`,
      targetUrl: normalizeTargetUrl("/workspaces"),
      payloadJson: {
        workspaceId: normalizeOptionalPositiveInteger(workspaceId, "workspaceId"),
        workspaceName: normalizedWorkspaceName,
        roleId: normalizedRoleId
      },
      actorUserId: normalizeOptionalPositiveInteger(actorUserId, "actorUserId"),
      workspaceId: normalizeOptionalPositiveInteger(workspaceId, "workspaceId")
    });
  }

  async function createConsoleInviteAlert({ userId, roleId = "member", actorUserId = null } = {}) {
    const normalizedRoleId = normalizeNullableText(roleId) || "member";

    return createAlert({
      userId: normalizeRequiredPositiveInteger(userId, "userId"),
      type: "console.invite.received",
      title: "Console invite",
      message: `You were invited to the console as ${normalizedRoleId}.`,
      targetUrl: normalizeTargetUrl("/console/invitations"),
      payloadJson: {
        roleId: normalizedRoleId
      },
      actorUserId: normalizeOptionalPositiveInteger(actorUserId, "actorUserId")
    });
  }

  return {
    listForUser,
    markAllReadForUser,
    createAlert,
    createWorkspaceInviteAlert,
    createConsoleInviteAlert
  };
}

const __testables = {
  validationError,
  normalizeText,
  normalizeNullableText,
  normalizeRequiredPositiveInteger,
  normalizeOptionalPositiveInteger,
  normalizeTargetUrl,
  normalizeType,
  normalizeTitle,
  normalizeMessage,
  normalizePayloadJson,
  normalizePagination,
  normalizeReadThroughAlertId,
  mapEntryWithReadStatus,
  normalizeAuthenticatedUser,
  resolveRealtimeEventsDependency,
  buildAlertCreatedRealtimeEvent,
  publishAlertCreatedRealtimeEventSafely
};

export { createService, __testables };
