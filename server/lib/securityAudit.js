import { parsePositiveInteger } from "./primitives/integers.js";
import { safePathnameFromRequest, resolveClientIpAddress } from "./primitives/requestUrl.js";
import { resolveSurfaceFromPathname } from "../../shared/routing/surfacePaths.js";

function resolveAuditSurface(pathnameValue, explicitSurface = "") {
  const normalizedExplicit = String(explicitSurface || "")
    .trim()
    .toLowerCase();
  if (normalizedExplicit) {
    return normalizedExplicit;
  }

  return resolveSurfaceFromPathname(pathnameValue);
}

function buildAuditEventBase(request) {
  const pathnameValue = safePathnameFromRequest(request);
  return {
    actorUserId: parsePositiveInteger(request?.user?.id),
    actorEmail: String(request?.user?.email || "")
      .trim()
      .toLowerCase(),
    surface: resolveAuditSurface(pathnameValue, request?.surface),
    requestId: String(request?.id || "").trim(),
    method: String(request?.method || "")
      .trim()
      .toUpperCase(),
    path: pathnameValue,
    ipAddress: resolveClientIpAddress(request),
    userAgent: String(request?.headers?.["user-agent"] || "")
  };
}

function buildAuditError(error) {
  const status = parsePositiveInteger(error?.status || error?.statusCode);
  return {
    name: String(error?.name || "Error"),
    code: String(error?.code || ""),
    status: status || null
  };
}

function normalizeObjectPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function resolveObjectPayload(value, context) {
  const resolvedValue = typeof value === "function" ? value(context) : value;
  return normalizeObjectPayload(resolvedValue);
}

function mergeMetadataPayloads(...parts) {
  const merged = {};
  for (const part of parts) {
    const payload = normalizeObjectPayload(part);
    for (const [key, value] of Object.entries(payload)) {
      merged[key] = value;
    }
  }

  return merged;
}

function buildEventPayload({ action, outcome, shared, event, metadata, context }) {
  const sharedPayload = resolveObjectPayload(shared, context);
  const eventPayload = resolveObjectPayload(event, context);
  const sharedMetadata = resolveObjectPayload(metadata, context);
  const eventMetadata = resolveObjectPayload(eventPayload.metadata, context);
  const mergedMetadata = mergeMetadataPayloads(sharedMetadata, eventMetadata);

  const payload = {
    ...sharedPayload,
    ...eventPayload,
    action,
    outcome
  };

  if (Object.keys(mergedMetadata).length > 0) {
    payload.metadata = mergedMetadata;
  } else {
    delete payload.metadata;
  }

  return payload;
}

function mergeFailureMetadata(error, metadata) {
  const normalizedMetadata = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? { ...metadata } : {};
  if (!Object.hasOwn(normalizedMetadata, "error")) {
    normalizedMetadata.error = buildAuditError(error);
  }

  return normalizedMetadata;
}

function logAuditFailure(request, payload, message) {
  if (!request?.log || typeof request.log.warn !== "function") {
    return;
  }

  request.log.warn(payload, message);
}

function safeBuildEventPayload({ request, action, outcome, shared, event, metadata, context, stage }) {
  try {
    return buildEventPayload({
      action,
      outcome,
      shared,
      event,
      metadata,
      context
    });
  } catch (error) {
    logAuditFailure(
      request,
      {
        action,
        outcome,
        stage,
        callbackError: buildAuditError(error)
      },
      "security.audit.callback_failed"
    );
    return {
      action,
      outcome
    };
  }
}

async function recordAuditEvent({ auditService, request, event }) {
  await auditService.recordSafe(
    {
      ...buildAuditEventBase(request),
      ...event
    },
    request?.log
  );
}

async function safeRecordAuditEvent({ auditService, request, event }) {
  try {
    await recordAuditEvent({
      auditService,
      request,
      event
    });
  } catch (error) {
    logAuditFailure(
      request,
      {
        action: String(event?.action || ""),
        outcome: String(event?.outcome || ""),
        recordError: buildAuditError(error)
      },
      "security.audit.record_unexpected_failure"
    );
  }
}

async function withAuditEvent({ auditService, request, action, execute, shared, metadata, onSuccess, onFailure }) {
  if (!auditService || typeof auditService.recordSafe !== "function") {
    throw new TypeError("withAuditEvent auditService.recordSafe is required.");
  }
  if (typeof execute !== "function") {
    throw new TypeError("withAuditEvent execute callback is required.");
  }

  try {
    const result = await execute();
    const successEvent = safeBuildEventPayload({
      request,
      action,
      outcome: "success",
      shared,
      event: onSuccess,
      metadata,
      context: {
        request,
        result,
        error: null,
        outcome: "success"
      },
      stage: "success"
    });
    await safeRecordAuditEvent({
      auditService,
      request,
      event: successEvent
    });
    return result;
  } catch (error) {
    const failureEvent = safeBuildEventPayload({
      request,
      action,
      outcome: "failure",
      shared,
      event: onFailure,
      metadata,
      context: {
        request,
        result: null,
        error,
        outcome: "failure"
      },
      stage: "failure"
    });

    await safeRecordAuditEvent({
      auditService,
      request,
      event: {
        ...failureEvent,
        metadata: mergeFailureMetadata(error, failureEvent.metadata)
      }
    });
    throw error;
  }
}

const __testables = {
  resolveAuditSurface,
  buildAuditEventBase,
  buildAuditError,
  normalizeObjectPayload,
  resolveObjectPayload,
  mergeMetadataPayloads,
  buildEventPayload,
  mergeFailureMetadata,
  safeBuildEventPayload
};

export { buildAuditEventBase, buildAuditError, recordAuditEvent, withAuditEvent, __testables };
